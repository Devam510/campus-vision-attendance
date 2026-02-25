"""
routers/engine.py – Engine start/stop/status control (Admin only).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Classroom, User
from schemas import EngineStartRequest, SystemMetrics
from auth import require_admin, get_current_user
from services.camera_service import engine_manager

router = APIRouter(prefix="/api/engine", tags=["engine"])


@router.get("/status")
async def engine_status(current_user: User = Depends(get_current_user)):
    return engine_manager.get_status()


@router.post("/start")
async def start_engine(
    data: EngineStartRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    cr = await db.execute(select(Classroom).where(Classroom.id == data.classroom_id))
    classroom = cr.scalar_one_or_none()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    if not classroom.is_active:
        raise HTTPException(status_code=400, detail="Classroom is inactive")

    success = await engine_manager.start(
        classroom_id=classroom.id,
        camera_source=classroom.camera_source,
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to start engine")
    return {"message": f"Engine started for classroom {classroom.classroom_name}"}


@router.post("/stop")
async def stop_engine(_: User = Depends(require_admin)):
    await engine_manager.stop()
    return {"message": "Engine stopped"}


@router.get("/metrics", response_model=SystemMetrics)
async def get_metrics(current_user: User = Depends(get_current_user)):
    from websocket import connection_manager

    status = engine_manager.get_status()
    metrics = engine_manager.get_metrics()
    return SystemMetrics(
        engine_running=status["running"],
        active_classroom_id=status.get("classroom_id"),
        fps=metrics.get("fps", 0.0),
        active_tracks=metrics.get("active_tracks", 0),
        frames_processed=metrics.get("frames_processed", 0),
        recognition_latency_ms=metrics.get("recognition_latency_ms", 0.0),
        ws_video_clients=connection_manager.video_client_count(),
        ws_presence_clients=connection_manager.presence_client_count(),
        db_ok=True,
    )
