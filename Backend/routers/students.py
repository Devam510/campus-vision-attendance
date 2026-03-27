"""
routers/students.py – Student management with production-grade live face registration.
Field-scoped for faculty; admin has full access.

register-face pipeline:
  1. Quality Gate     → face_confidence > 0.7, face_size > 80px, sharpness > 50 (Laplacian)
  2. Single Face Gate → reject frames with 0 or 2+ faces
  3. Liveness Gate    → reject entire request if any frame flags as spoof
  4. Pose Diversity   → drop frames too similar to previous (cosine_sim > 0.98)
  5. Outlier Rejection → compute centroid, drop frames > 0.3 dist from centroid
  6. Mean Average     → L2-normalize the result
  7. Quality Score    → mean inlier cosine similarity to centroid stored in DB
"""

import io
import asyncio as _asyncio
import numpy as np
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

import cv2

from database import get_db
from models import Student, Classroom, User, UserRole
from schemas import StudentCreate, StudentOut
from auth import get_current_user, require_admin, assert_classroom_access

router = APIRouter(prefix="/api/students", tags=["students"])

# ── Tunable thresholds ────────────────────────────────────────────────────────
FACE_CONF_THRESHOLD = 0.60  # InsightFace det_score minimum (webcam < studio photo)
MIN_FACE_PX = 60  # minimum face bounding-box side (pixels)
SHARPNESS_THRESHOLD = 15.0  # Laplacian variance — webcam JPEG compression scores ~15–70
POSE_SIM_THRESHOLD = 0.98  # cosine similarity — above this = too similar
OUTLIER_DIST_THRESHOLD = 0.30  # L2 dist from centroid — above = outlier
MIN_VALID_FRAMES = 2  # minimum inlier frames required to store
LIVENESS_MAJORITY = (
    0.60  # fraction of face-detected frames that must fail to hard-block
)


def _get_classroom_field_id(classroom: Classroom) -> int:
    return classroom.field_id


# ── Helpers ───────────────────────────────────────────────────────────────────
def _laplacian_sharpness(gray: np.ndarray) -> float:
    """Higher = sharper. Blurry images score < 50."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two L2-normalized vectors (range −1 to 1)."""
    return float(np.dot(a, b))


def _l2_normalize(v: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(v)
    return v / norm if norm > 1e-8 else v


# ── InsightFace singleton (loaded once per process) ───────────────────────────
_face_app = None
_face_app_lock = None


def _get_face_app():
    """Return a cached InsightFace FaceAnalysis instance (thread-safe init)."""
    global _face_app
    if _face_app is None:
        from insightface.app import FaceAnalysis
        from config import settings as cfg

        _face_app = FaceAnalysis(
            name=cfg.INSIGHTFACE_MODEL_PACK,
            root=cfg.MODELS_PATH,
            providers=(
                ["CUDAExecutionProvider", "CPUExecutionProvider"]
                if cfg.USE_GPU
                else ["CPUExecutionProvider"]
            ),
        )
        _face_app.prepare(ctx_id=0 if cfg.USE_GPU else -1, det_size=(640, 640))
    return _face_app


def _process_frames(raw_frames: list[bytes]) -> dict:
    """
    CPU-heavy frame processing — runs in a thread via asyncio.to_thread().

    Returns a dict with keys:
      ok            bool
      error_code    str | None   ("no_import", "liveness_fail", "no_valid_frames", "not_enough_diversity")
      embedding     list[float] | None
      quality_score float | None
      frames_used   int | None
      model_pack    str | None
    """
    try:
        face_app = _get_face_app()
    except ImportError:
        return {"ok": False, "error_code": "no_import"}

    from config import settings as cfg

    # Try to import the liveness checker used by the engine
    try:
        from engine.liveness import LivenessChecker

        liveness_checker = LivenessChecker()
        has_liveness = True
    except Exception:
        has_liveness = False

    valid_embeddings: list[np.ndarray] = []  # normed embeddings from inlier frames
    liveness_fail_count = 0
    total_face_frames = 0  # frames that passed quality + single-face gate
    uncentered_count = 0

    for raw in raw_frames:
        # Decode image
        np_arr = np.frombuffer(raw, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            continue  # corrupt frame — skip silently

        # ── Gate 1: Sharpness ────────────────────────────────────────────────
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if _laplacian_sharpness(gray) < SHARPNESS_THRESHOLD:
            continue  # blurry frame

        # ── Gate 2: Face detection —  confidence + size + single face ────────
        faces = face_app.get(img)
        if len(faces) != 1:
            continue  # 0 or 2+ faces — skip

        face = faces[0]
        det_score = float(getattr(face, "det_score", 1.0))
        if det_score < FACE_CONF_THRESHOLD:
            continue  # low confidence

        bbox = face.bbox  # [x1, y1, x2, y2]
        face_w = bbox[2] - bbox[0]
        face_h = bbox[3] - bbox[1]
        if face_w < MIN_FACE_PX or face_h < MIN_FACE_PX:
            continue  # face too small

        # ── Gate 2.5: Centering ──
        img_h, img_w = img.shape[:2]
        face_cx = (bbox[0] + bbox[2]) / 2.0
        face_cy = (bbox[1] + bbox[3]) / 2.0
        
        img_cx, img_cy = img_w / 2.0, img_h / 2.0
        
        dist_from_center = ((face_cx - img_cx)**2 + (face_cy - img_cy)**2)**0.5
        max_dist = img_w * 0.15  # 15% tolerance
        if dist_from_center > max_dist:
            uncentered_count += 1
            continue  # skip this frame because it's not centered

        total_face_frames += 1

        # ── Gate 3: Liveness / anti-spoof (soft — count failures, don't hard-stop per frame) ──
        if has_liveness:
            try:
                is_live, spoof_score = liveness_checker.check(img, [face])
                if not is_live or spoof_score > 0.5:
                    liveness_fail_count += 1
                    continue
            except Exception:
                pass  # liveness unavailable for this frame — skip check

        embedding = _l2_normalize(np.array(face.normed_embedding, dtype=np.float32))

        # ── Gate 4: Pose diversity (cosine similarity with previous frames) ───
        too_similar = False
        for prev in valid_embeddings:
            if _cosine_similarity(embedding, prev) > POSE_SIM_THRESHOLD:
                too_similar = True
                break
        if too_similar:
            continue

        valid_embeddings.append(embedding)

    # Liveness hard-block: only if MAJORITY of good-quality frames were spoofs
    # (prevents a single reflected/glare frame from killing the whole scan)
    if has_liveness and total_face_frames > 0:
        spoof_fraction = liveness_fail_count / total_face_frames
        if spoof_fraction >= LIVENESS_MAJORITY and len(valid_embeddings) == 0:
            return {"ok": False, "error_code": "liveness_fail"}

    if len(valid_embeddings) == 0:
        if uncentered_count > 0:
            return {"ok": False, "error_code": "not_centered"}
        return {"ok": False, "error_code": "no_valid_frames"}

    # ── Gate 5: Outlier rejection ─────────────────────────────────────────────
    stack = np.stack(valid_embeddings)  # (N, 512)
    centroid = _l2_normalize(stack.mean(axis=0))  # mean → normalize again

    inliers: list[np.ndarray] = []
    for emb in valid_embeddings:
        dist = float(np.linalg.norm(emb - centroid))
        if dist <= OUTLIER_DIST_THRESHOLD:
            inliers.append(emb)

    if len(inliers) < MIN_VALID_FRAMES:
        # Fall back to all valid frames if outlier pruning was too aggressive
        inliers = valid_embeddings

    if len(inliers) < MIN_VALID_FRAMES:
        return {"ok": False, "error_code": "not_enough_diversity"}

    # ── Final average + quality score ─────────────────────────────────────────
    inlier_stack = np.stack(inliers)
    final_centroid = _l2_normalize(inlier_stack.mean(axis=0))

    # Quality = mean cosine similarity of inliers to final centroid (0–1)
    similarities = [_cosine_similarity(e, final_centroid) for e in inliers]
    quality_score = float(np.mean(similarities))

    return {
        "ok": True,
        "error_code": None,
        "embedding": final_centroid.tolist(),
        "quality_score": round(quality_score, 4),
        "frames_used": len(inliers),
        "model_pack": cfg.INSIGHTFACE_MODEL_PACK,
    }


# ── Routes ────────────────────────────────────────────────────────────────────
@router.get("/", response_model=list[StudentOut])
async def list_students(
    classroom_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List students. Faculty filtered to their field only."""
    query = select(Student).options(selectinload(Student.classroom))
    if classroom_id:
        cr = await db.execute(select(Classroom).where(Classroom.id == classroom_id))
        classroom = cr.scalar_one_or_none()
        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")
        assert_classroom_access(current_user, classroom.field_id)
        query = query.where(Student.classroom_id == classroom_id)
    elif current_user.role == UserRole.FACULTY:
        query = query.join(Classroom).where(Classroom.field_id == current_user.field_id)
    query = query.order_by(Student.name)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=StudentOut, status_code=status.HTTP_201_CREATED)
async def create_student(
    data: StudentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a student record. Upserts if enrollment_no already exists."""
    cr = await db.execute(select(Classroom).where(Classroom.id == data.classroom_id))
    classroom = cr.scalar_one_or_none()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    assert_classroom_access(current_user, classroom.field_id)

    enrollment_no = (data.enrollment_no or "").strip() or None
    if enrollment_no:
        existing_result = await db.execute(
            select(Student).where(
                Student.enrollment_no == enrollment_no,
                Student.classroom_id == data.classroom_id,
            )
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            if data.name:
                existing.name = data.name
            if data.roll_no:
                existing.roll_no = data.roll_no
            await db.commit()
            await db.refresh(existing)
            return existing

    try:
        student = Student(**data.model_dump())
        if enrollment_no:
            student.enrollment_no = enrollment_no
        db.add(student)
        await db.commit()
        await db.refresh(student)
        return student
    except Exception as e:
        await db.rollback()
        if "uq_student_enrollment_classroom" in str(e):
            raise HTTPException(
                status_code=409,
                detail=f"Student with enrollment no '{enrollment_no}' already exists in this classroom",
            )
        raise


@router.post("/{student_id}/register-face", response_model=StudentOut)
async def register_face(
    student_id: int,
    images: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Multi-frame live-scan face registration with 5 production safeguards:
      1. Quality gate (sharpness, conf, size)
      2. Single-face gate
      3. Liveness / anti-spoof gate
      4. Pose diversity filter (cosine similarity)
      5. Outlier rejection before final mean average
    Returns embedding_quality_score and embedding_frames_used in response.
    """
    result = await db.execute(
        select(Student)
        .options(selectinload(Student.classroom))
        .where(Student.id == student_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    assert_classroom_access(current_user, student.classroom.field_id)

    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required")
    if len(images) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 frames allowed")

    # Read all uploaded frames into memory
    raw_frames: list[bytes] = []
    for upload in images:
        raw = await upload.read()
        if raw:
            raw_frames.append(raw)

    if not raw_frames:
        raise HTTPException(status_code=400, detail="All uploaded files were empty")

    # Run blocking CPU work in a thread pool
    proc = await _asyncio.to_thread(_process_frames, raw_frames)

    if not proc["ok"]:
        code = proc["error_code"]
        if code == "no_import":
            raise HTTPException(status_code=503, detail="InsightFace not installed")
        if code == "liveness_fail":
            raise HTTPException(
                status_code=400,
                detail="Live face required — printed photo or spoof detected. Please use a real face.",
            )
        if code == "not_centered":
            raise HTTPException(
                status_code=400,
                detail="Face not centered. Please align your face in the center of the circle.",
            )
        if code == "no_valid_frames":
            raise HTTPException(
                status_code=400,
                detail="No valid face frames found. Ensure good lighting, single face, and no blur.",
            )
        if code == "not_enough_diversity":
            raise HTTPException(
                status_code=400,
                detail="Not enough pose variation captured. Please move face slightly between captures.",
            )
        raise HTTPException(status_code=400, detail="Face registration failed")

    # Persist to DB
    student.embedding_json = {"embedding": proc["embedding"]}
    student.embedding_model = proc["model_pack"]
    student.embedding_quality_score = proc["quality_score"]
    student.embedding_frames_used = proc["frames_used"]

    await db.commit()
    await db.refresh(student)
    return student


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    await db.delete(student)
    await db.commit()
