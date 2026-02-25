"""
services/camera_service.py – EngineManager: lifecycle for the attendance engine.
Thread-safe start/stop with mutex. Single engine per server.
"""

import asyncio
import threading
import logging
from typing import Optional

log = logging.getLogger("camera_service")


class EngineManager:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._running = False
        self._classroom_id: Optional[int] = None
        self._camera_source: Optional[str] = None
        self._metrics: dict = {}
        self._frame_queues: dict[int, "queue.Queue"] = {}  # classroom_id → frame queue
        self._engine_ref = None
        self._status = "STOPPED"  # STOPPED | STARTING | RUNNING | ERROR

    async def start(self, classroom_id: int, camera_source: str) -> bool:
        async with self._lock:
            if self._running:
                await self._do_stop()

            self._status = "STARTING"
            self._stop_event.clear()
            self._classroom_id = classroom_id
            self._camera_source = camera_source

            import queue as queue_module
            from config import settings

            frame_q = queue_module.Queue(maxsize=settings.FRAME_QUEUE_MAX)
            self._frame_queues[classroom_id] = frame_q

            # Import engine inline to avoid circular imports
            from engine.attendance_engine import run_engine

            # Capture the MAIN event loop — asyncpg connections are bound to it.
            # The engine thread must dispatch DB calls here, not create a new loop.
            main_loop = asyncio.get_running_loop()

            def _run():
                try:
                    self._running = True
                    self._status = "RUNNING"
                    run_engine(
                        classroom_id=classroom_id,
                        camera_source=camera_source,
                        stop_event=self._stop_event,
                        frame_queue=frame_q,
                        metrics=self._metrics,
                        main_loop=main_loop,
                    )
                except Exception as e:
                    log.error("Engine crashed: %s", e, exc_info=True)
                    self._status = "ERROR"
                finally:
                    self._running = False
                    if self._status != "ERROR":
                        self._status = "STOPPED"
                    log.info("Engine thread exited")

            self._thread = threading.Thread(
                target=_run, daemon=True, name="engine-thread"
            )
            self._thread.start()
            log.info(
                "Engine started for classroom %d (camera: %s)",
                classroom_id,
                camera_source,
            )
            return True

    async def stop(self):
        async with self._lock:
            await self._do_stop()

    async def _do_stop(self):
        if not self._running and self._thread is None:
            return
        log.info("Stopping engine...")
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)
            if self._thread.is_alive():
                log.warning("Engine thread did not stop cleanly within 10s")
        self._thread = None
        self._running = False
        self._classroom_id = None
        self._status = "STOPPED"
        self._frame_queues.clear()
        log.info("Engine stopped")

    def get_frame_queue(self, classroom_id: int):
        return self._frame_queues.get(classroom_id)

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "status": self._status,
            "classroom_id": self._classroom_id,
            "camera_source": self._camera_source,
        }

    def get_metrics(self) -> dict:
        return dict(self._metrics)


engine_manager = EngineManager()
