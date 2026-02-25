"""
main.py – FastAPI application entry point.
CORS, lifespan (DB init + sync loop), router mounts, MJPEG fallback.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config import settings
from database import init_db, AsyncSessionLocal
from utils.logger import setup_logging

import auth
import websocket as ws_module
from routers import (
    fields,
    classrooms,
    users,
    students,
    lectures,
    attendance,
    sheets,
    engine as engine_router,
)
from services.camera_service import engine_manager
from services.google_sheets_service import run_sheet_sync_loop
from auth import get_current_user

setup_logging()
log = logging.getLogger("main")

# ── Rate Limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(
    key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_GENERAL]
)


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    log.info("Starting AI Attendance System v5...")
    await init_db()
    log.info("Database initialized")

    # Start Google Sheets background sync loop
    sync_task = asyncio.create_task(run_sheet_sync_loop(AsyncSessionLocal))
    log.info("Google Sheets sync loop started")

    yield  # App runs here

    # Shutdown
    log.info("Shutting down...")
    await engine_manager.stop()
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
    log.info("Shutdown complete")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AI Attendance System",
    version="5.0.0",
    description="Multi-field AI-powered attendance system with real-time tracking",
    lifespan=lifespan,
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# GZip — compress responses >1KB (JSON APIs benefit most)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(fields.router)
app.include_router(classrooms.router)
app.include_router(users.router)
app.include_router(students.router)
app.include_router(lectures.router)
app.include_router(attendance.router)
app.include_router(sheets.router)
app.include_router(engine_router.router)
app.include_router(ws_module.router)


# ── MJPEG Fallback ────────────────────────────────────────────────────────────
@app.get("/api/video_feed/{classroom_id}")
async def mjpeg_feed(
    classroom_id: int,
    current_user=Depends(get_current_user),
):
    """MJPEG fallback stream for browsers/tools not supporting WebSocket."""

    def generate():
        import time

        frame_q = engine_manager.get_frame_queue(classroom_id)
        while True:
            if frame_q is None:
                time.sleep(1)
                frame_q = engine_manager.get_frame_queue(classroom_id)
                continue
            try:
                jpeg_bytes = frame_q.get(timeout=2)
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg_bytes + b"\r\n"
                )
            except Exception:
                # Send a minimal 1x1 black JPEG to keep stream alive
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
                    + b"\xff\xd9"
                    + b"\r\n"
                )

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "version": "5.0.0"}


# ── Entry Point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        http="httptools",  # faster HTTP parser
        timeout_keep_alive=30,  # keep TCP connections alive 30s
        log_level=settings.LOG_LEVEL.lower(),
    )
