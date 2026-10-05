"""Cameras: configuration (persisted) and live status (from Vision heartbeats).

Vision -> backend
    PUT  /api/v1/cameras/{id}/heartbeat                    every few seconds
    GET  /api/v1/cameras/{id}/commands/next?wait=20        long-poll for changes to apply
    POST /api/v1/cameras/{id}/commands/{command_id}/result Vision confirms (or refuses)

Dashboard
    GET  /api/v1/cameras                 cameras known to the backend (survive restarts)
    GET  /api/v1/cameras/{id}/status     live health; offline when Vision is silent
    GET  /api/v1/cameras/{id}/config     the counting line Vision uses (or last used)
    PUT  /api/v1/cameras/{id}/config     change line / direction / confidence (applied by
                                         Vision, confirmed before 200) and capacity

Live video is served by GET /api/v1/video/{id} (see routers/video.py).
Each heartbeat is pushed to dashboards as a CAMERA_STATUS WebSocket message.
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query, Request, Response, status

from app.cameras import CameraRegistry
from app.deps import get_manager, require_ingest_key
from app.schemas import (
    Camera,
    CameraConfig,
    CameraConfigIn,
    CameraConfigMessage,
    CameraStatus,
    CameraStatusMessage,
    VisionCommand,
    VisionCommandResult,
    VisionHeartbeat,
    VisionLineConfig,
)
from app.websocket import ConnectionManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/cameras", tags=["cameras"])

CameraId = Path(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")

# How long PUT /config waits for Vision to apply a change before giving up.
APPLY_TIMEOUT_SECONDS = 8.0


def get_registry(request: Request) -> CameraRegistry:
    return request.app.state.cameras


def _known_or_404(registry: CameraRegistry, camera_id: str) -> None:
    if not registry.known(camera_id):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"Camera {camera_id} has never reported to the backend (is the Vision server running?)",
        )


async def _broadcast_status(manager: ConnectionManager, registry: CameraRegistry, camera_id: str) -> None:
    current = registry.status(camera_id)
    registry.announced[camera_id] = current.status
    await manager.broadcast(CameraStatusMessage(data=current).model_dump())


async def _broadcast_config(manager: ConnectionManager, registry: CameraRegistry, camera_id: str) -> None:
    config = registry.config(camera_id)
    if config is not None:
        await manager.broadcast(CameraConfigMessage(data=config).model_dump())


# --- Vision -> backend ---------------------------------------------------------


@router.put(
    "/{camera_id}/heartbeat",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_ingest_key)],
)
def heartbeat(
    heartbeat: VisionHeartbeat,
    background_tasks: BackgroundTasks,
    camera_id: str = CameraId,
    registry: CameraRegistry = Depends(get_registry),
    manager: ConnectionManager = Depends(get_manager),
) -> Response:
    config_changed = registry.record(camera_id, heartbeat)
    background_tasks.add_task(_broadcast_status, manager, registry, camera_id)
    if config_changed:
        # e.g. Vision finished loading and now reports its counting line
        background_tasks.add_task(_broadcast_config, manager, registry, camera_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{camera_id}/commands/next",
    response_model=VisionCommand,
    dependencies=[Depends(require_ingest_key)],
    responses={204: {"description": "Nothing to do (poll again)"}},
)
async def next_command(
    camera_id: str = CameraId,
    wait: float = Query(default=20, ge=0, le=60, description="Seconds to wait for a command"),
    registry: CameraRegistry = Depends(get_registry),
):
    command = await registry.next_command(camera_id, wait)
    if command is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    logger.info("Command %s delivered to Vision for %s", command.command_id, camera_id)
    return command


@router.post(
    "/{camera_id}/commands/{command_id}/result",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_ingest_key)],
)
def command_result(
    result: VisionCommandResult,
    camera_id: str = CameraId,
    command_id: str = Path(pattern=r"^[0-9a-f]{32}$"),
    registry: CameraRegistry = Depends(get_registry),
) -> Response:
    if not registry.resolve(camera_id, command_id, result):
        # The dashboard request already timed out (or was replaced); nothing waits for it.
        logger.warning("Late or unknown result for command %s (%s)", command_id, camera_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Dashboard -----------------------------------------------------------------


def _stream_url(request: Request, camera_id: str) -> str:
    """Where this camera's live MJPEG is served. 404 there while Vision is not sending video."""
    return str(request.url_for("stream_video", camera_id=camera_id))


@router.get("", response_model=list[Camera])
def list_cameras(request: Request, registry: CameraRegistry = Depends(get_registry)) -> list[Camera]:
    return [registry.camera(cid, _stream_url(request, cid)) for cid in registry.ids()]


@router.get("/{camera_id}/status", response_model=CameraStatus, responses={404: {"description": "Unknown camera"}})
def camera_status(camera_id: str = CameraId, registry: CameraRegistry = Depends(get_registry)) -> CameraStatus:
    _known_or_404(registry, camera_id)
    return registry.status(camera_id)


@router.get(
    "/{camera_id}/config",
    response_model=CameraConfig,
    responses={404: {"description": "Unknown camera, or Vision never reported a counting line"}},
)
def camera_config(camera_id: str = CameraId, registry: CameraRegistry = Depends(get_registry)) -> CameraConfig:
    _known_or_404(registry, camera_id)
    config = registry.config(camera_id)
    if config is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Camera {camera_id} has no counting line (Vision has not run in count mode)")
    return config


@router.put(
    "/{camera_id}/config",
    response_model=CameraConfig,
    responses={
        404: {"description": "Unknown camera"},
        409: {"description": "Vision is offline, not counting, or refused the change"},
        422: {"description": "Invalid line / values"},
        504: {"description": "Vision did not confirm the change in time"},
    },
)
async def update_camera_config(
    body: CameraConfigIn,
    background_tasks: BackgroundTasks,
    camera_id: str = CameraId,
    registry: CameraRegistry = Depends(get_registry),
    manager: ConnectionManager = Depends(get_manager),
) -> CameraConfig:
    _known_or_404(registry, camera_id)
    if body.camera_id is not None and body.camera_id != camera_id:
        raise HTTPException(422, detail="camera_id in the body does not match the URL")

    wanted = VisionLineConfig(line=body.line, entry_direction=body.entry_direction,
                              detection_confidence=body.detection_confidence)
    current = registry.config(camera_id)
    vision_change = current is None or (
        wanted.line.model_dump() != current.line.model_dump()
        or wanted.entry_direction != current.entry_direction
        or abs(wanted.detection_confidence - current.detection_confidence) > 1e-6
    )

    if vision_change:
        # Never pretend: the line only changes if the running Vision applies it.
        if registry.status_kind(camera_id) == "offline":
            raise HTTPException(status.HTTP_409_CONFLICT,
                                detail="Vision is offline for this camera - start Vision to change the counting line")
        if registry.mode(camera_id) != "count":
            raise HTTPException(status.HTTP_409_CONFLICT,
                                detail="Vision is not in count mode, so it has no counting line to change")
        command = VisionCommand(config=wanted)
        future = registry.send(camera_id, command)
        try:
            result: VisionCommandResult = await asyncio.wait_for(future, APPLY_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            registry.forget(camera_id, command.command_id)
            raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT,
                                detail="Vision did not confirm the change in time - the counting line was NOT changed")
        if not result.ok or result.config is None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Vision refused the change: {result.error or 'unknown error'}")
        registry.apply_vision_config(camera_id, result.config)
        logger.info("Vision applied new counting config for %s: %s", camera_id, result.config.model_dump())

    if body.capacity != (current.capacity if current else None):
        registry.set_capacity(camera_id, body.capacity)

    background_tasks.add_task(_broadcast_status, manager, registry, camera_id)
    background_tasks.add_task(_broadcast_config, manager, registry, camera_id)
    return registry.config(camera_id)
