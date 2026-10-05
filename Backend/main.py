"""Latest Scoop backend: FastAPI application entry point.

Run with:  uvicorn main:app --host 0.0.0.0 --port 8000
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import database
from app.cameras import CameraRegistry
from app.config import Settings
from app.incident_store import incident_db
from app.routers import cameras, counts, events, health, incidents, video, ws
from app.schemas import CameraStatusMessage
from app.video import FrameHub
from app.websocket import ConnectionManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

WATCHDOG_SECONDS = 2.0


async def _camera_watchdog(app: FastAPI) -> None:
    """Tell dashboards when a camera's status changes without a heartbeat.

    Heartbeats announce themselves; this catches the opposite case - Vision
    stopped or crashed - and pushes the camera's transition to offline.
    """
    registry: CameraRegistry = app.state.cameras
    while True:
        await asyncio.sleep(WATCHDOG_SECONDS)
        for camera_id in registry.ids():
            current = registry.status(camera_id)
            if registry.announced.get(camera_id) != current.status:
                registry.announced[camera_id] = current.status
                logger.info("Camera %s is now %s", camera_id, current.status)
                await app.state.manager.broadcast(CameraStatusMessage(data=current).model_dump())


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database.init_db(settings.db_path)
        # Camera configuration persists; live status starts offline until Vision reports.
        app.state.cameras.load()
        incident_db.set_database_path(settings.incidents_db_path)
        incident_db.create_table()
        Path(settings.incident_images_dir).mkdir(parents=True, exist_ok=True)
        logger.info("Incidents DB: %s | images: %s", settings.incidents_db_path, settings.incident_images_dir)
        watchdog = asyncio.create_task(_camera_watchdog(app))
        try:
            yield
        finally:
            watchdog.cancel()

    app = FastAPI(title="Latest Scoop API", version="1.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.manager = ConnectionManager()
    app.state.frame_hub = FrameHub()
    app.state.cameras = CameraRegistry(timeout_seconds=settings.camera_timeout_seconds, db_path=settings.db_path)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
    )

    app.include_router(events.router)
    app.include_router(counts.router)
    app.include_router(incidents.router)
    app.include_router(cameras.router)
    app.include_router(health.router)
    app.include_router(ws.router)
    app.include_router(video.router)
    return app


app = create_app()
