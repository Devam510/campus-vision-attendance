"""
websocket.py – WebSocket handlers for /ws/video and /ws/presence.
Includes JWT auth, adaptive quality, auto-reconnect messages, and per-classroom isolation.
"""

import asyncio
import json
import logging
import queue
import time
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect, APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, AsyncSessionLocal
from models import Lecture, PresenceTracking, Student
from auth import get_current_user_from_query_token
from services.camera_service import engine_manager
from config import settings
from sqlalchemy import select
from sqlalchemy.orm import selectinload

log = logging.getLogger("websocket")
router = APIRouter(tags=["websocket"])


# ── Connection Manager ────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self._video_clients: dict[int, list[WebSocket]] = {}  # classroom_id → [ws]
        self._presence_clients: dict[int, list[WebSocket]] = {}  # classroom_id → [ws]
        self._lock = asyncio.Lock()

    # ── Video ─────────────────────────────────────────────────────────────────
    async def add_video_client(self, classroom_id: int, ws: WebSocket):
        async with self._lock:
            if classroom_id not in self._video_clients:
                self._video_clients[classroom_id] = []
            self._video_clients[classroom_id].append(ws)

    async def remove_video_client(self, classroom_id: int, ws: WebSocket):
        async with self._lock:
            if classroom_id in self._video_clients:
                (
                    self._video_clients[classroom_id].discard(ws)
                    if hasattr(self._video_clients[classroom_id], "discard")
                    else None
                )
                try:
                    self._video_clients[classroom_id].remove(ws)
                except ValueError:
                    pass

    def video_client_count(self, classroom_id: int | None = None) -> int:
        if classroom_id:
            return len(self._video_clients.get(classroom_id, []))
        return sum(len(v) for v in self._video_clients.values())

    # ── Presence ──────────────────────────────────────────────────────────────
    async def add_presence_client(self, classroom_id: int, ws: WebSocket):
        async with self._lock:
            if classroom_id not in self._presence_clients:
                self._presence_clients[classroom_id] = []
            self._presence_clients[classroom_id].append(ws)

    async def remove_presence_client(self, classroom_id: int, ws: WebSocket):
        async with self._lock:
            if classroom_id in self._presence_clients:
                try:
                    self._presence_clients[classroom_id].remove(ws)
                except ValueError:
                    pass

    def presence_client_count(self) -> int:
        return sum(len(v) for v in self._presence_clients.values())

    async def broadcast_presence(self, classroom_id: int, data: dict):
        clients = list(self._presence_clients.get(classroom_id, []))
        dead = []
        for ws in clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.remove_presence_client(classroom_id, ws)


connection_manager = ConnectionManager()


# ── Adaptive Quality ──────────────────────────────────────────────────────────
def _get_target_resolution(classroom_id: int) -> tuple[int, int]:
    """Returns (width, height) based on current viewer count."""
    count = connection_manager.video_client_count(classroom_id)
    if count <= settings.WS_DOWNSCALE_THRESHOLD:
        return (1280, 720)
    elif count <= settings.WS_DOWNSCALE_THRESHOLD_2:
        return (854, 480)
    else:
        return (640, 360)


def _resize_frame(frame: np.ndarray, target_w: int, target_h: int) -> bytes:
    """Resize frame and encode as JPEG bytes."""
    h, w = frame.shape[:2]
    if w != target_w:
        scale = target_w / w
        frame = cv2.resize(frame, (target_w, int(h * scale)))
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
    return bytes(buf) if ok else b""


# ── /ws/video ────────────────────────────────────────────────────────────────
@router.websocket("/ws/video")
async def video_ws(
    websocket: WebSocket,
    token: str = Query(...),
    classroom_id: int = Query(...),
):
    """Stream JPEG frames as binary WebSocket messages."""
    # Auth
    async with AsyncSessionLocal() as db:
        try:
            user = await get_current_user_from_query_token(token, db)
        except Exception:
            await websocket.close(code=4001, reason="Unauthorized")
            return

    # Capacity check
    if (
        connection_manager.video_client_count(classroom_id)
        >= settings.WS_MAX_CLIENTS_PER_CLASSROOM
    ):
        await websocket.close(code=4002, reason="Too many viewers for this classroom")
        return

    await websocket.accept()
    await connection_manager.add_video_client(classroom_id, websocket)
    log.info("Video WS connected: user=%s classroom=%d", user.username, classroom_id)

    try:
        while True:
            frame_q = engine_manager.get_frame_queue(classroom_id)
            if frame_q is None:
                # Engine not running — inform client and wait before retrying
                await websocket.send_json({"type": "engine_stopped"})
                await asyncio.sleep(2)
                continue

            # ── Non-blocking frame fetch ──────────────────────────────────────
            # frame_q.get() is a blocking C-level call.  Wrapping it in
            # asyncio.to_thread() keeps the event loop free while waiting,
            # so page-switches and other WS connections are never stalled.
            try:
                raw_bytes: bytes = await asyncio.to_thread(
                    frame_q.get, True, 0.5  # blocking=True, timeout=0.5s
                )
            except queue.Empty:
                # No frame in 0.5s — send lightweight keepalive
                try:
                    await websocket.send_json({"type": "keepalive"})
                except Exception:
                    break
                continue
            except Exception:
                await asyncio.sleep(0.1)
                continue

            # Adaptive quality: skip resize if not needed
            target_w, target_h = _get_target_resolution(classroom_id)
            np_arr = np.frombuffer(raw_bytes, dtype=np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
            out_bytes = _resize_frame(frame, target_w, target_h)
            if out_bytes:
                await websocket.send_bytes(out_bytes)

    except WebSocketDisconnect:
        log.info(
            "Video WS disconnected: user=%s classroom=%d", user.username, classroom_id
        )
    except Exception as e:
        log.error("Video WS error: %s", e)
    finally:
        await connection_manager.remove_video_client(classroom_id, websocket)


# ── /ws/presence ──────────────────────────────────────────────────────────────
@router.websocket("/ws/presence")
async def presence_ws(
    websocket: WebSocket,
    token: str = Query(...),
    classroom_id: int = Query(...),
):
    """Stream real-time presence updates as JSON."""
    async with AsyncSessionLocal() as db:
        try:
            user = await get_current_user_from_query_token(token, db)
        except Exception:
            await websocket.close(code=4001, reason="Unauthorized")
            return

    await websocket.accept()
    await connection_manager.add_presence_client(classroom_id, websocket)
    log.info("Presence WS connected: user=%s classroom=%d", user.username, classroom_id)

    THROTTLE_INTERVAL = 0.75  # seconds — max ~1.3 updates/sec per client
    last_sent = 0.0

    try:
        while True:
            await asyncio.sleep(0.1)  # tight loop; throttle below

            now_mono = time.monotonic()
            if now_mono - last_sent < THROTTLE_INTERVAL:
                continue

            # Check token not expired (rough check)
            try:
                from auth import decode_token

                decode_token(token)
            except Exception:
                await websocket.send_json({"type": "auth_expired"})
                break

            # Fetch current lecture + presence
            # DB stores datetimes as IST-naive (from sheet sync).
            # Use datetime.now() (IST naive) so comparison is apples-to-apples.
            async with AsyncSessionLocal() as db:
                now = datetime.now()
                lect_result = await db.execute(
                    select(Lecture)
                    .where(
                        Lecture.classroom_id == classroom_id,
                        Lecture.lecture_date == now.date(),
                        Lecture.start_time <= now,
                        Lecture.end_time >= now,
                        Lecture.finalized == False,
                    )
                    .order_by(Lecture.start_time.asc())
                    .limit(1)
                )
                lecture = lect_result.scalars().first()

                if not lecture:
                    await websocket.send_json(
                        {
                            "type": "no_active_lecture",
                            "classroom_id": classroom_id,
                            "timestamp": now.isoformat(),
                        }
                    )
                    last_sent = time.monotonic()
                    continue

                pr_result = await db.execute(
                    select(PresenceTracking)
                    .options(selectinload(PresenceTracking.student))
                    .where(PresenceTracking.lecture_id == lecture.id)
                )
                records = pr_result.scalars().all()

                students_data = [
                    {
                        "student_id": r.student_id,
                        "name": r.student.name if r.student else "",
                        "enrollment_no": r.student.enrollment_no if r.student else "",
                        "total_seconds": round(r.total_present_seconds, 1),
                        "status": r.status.value,
                        "last_seen": r.last_seen.isoformat() if r.last_seen else None,
                    }
                    for r in records
                ]

                await websocket.send_json(
                    {
                        "type": "presence_update",
                        "lecture_id": lecture.id,
                        "lecture_name": lecture.lecture_name,
                        "start_time": lecture.start_time.isoformat(),
                        "end_time": lecture.end_time.isoformat(),
                        "students": students_data,
                        "timestamp": now.isoformat(),
                    }
                )
                last_sent = time.monotonic()  # ← reset throttle

    except WebSocketDisconnect:
        log.info(
            "Presence WS disconnected: user=%s classroom=%d",
            user.username,
            classroom_id,
        )
    except Exception as e:
        log.error("Presence WS error: %s", e)
    finally:
        await connection_manager.remove_presence_client(classroom_id, websocket)
