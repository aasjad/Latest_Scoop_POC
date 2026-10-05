"""Live camera video.

AI Engine -> FastAPI:  WebSocket /ws/video/ingest/{camera_id}, one binary JPEG per message.
FastAPI -> React:      GET /api/v1/video/{camera_id} as MJPEG, usable directly in <img src>.
"""

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response, StreamingResponse

from app.deps import is_valid_ingest_key
from app.schemas import VideoCamerasResponse
from app.video import CameraFeed, FrameHub

logger = logging.getLogger(__name__)

router = APIRouter(tags=["video"])

BOUNDARY = "frame"
JPEG_MAGIC = b"\xff\xd8"
# If the camera pauses, the last frame is re-sent this often so dead viewers are detected.
KEEPALIVE_SECONDS = 5.0

# WebSocket close codes (RFC 6455).
POLICY_VIOLATION = 1008
UNSUPPORTED_DATA = 1003
MESSAGE_TOO_BIG = 1009


def _hub(request_or_ws) -> FrameHub:
    return request_or_ws.app.state.frame_hub


def _get_feed(request: Request, camera_id: str) -> CameraFeed:
    feed = _hub(request).get(camera_id)
    if feed is None or feed.frame is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Camera is not streaming")
    return feed


# --- AI Engine -> FastAPI --------------------------------------------------


@router.websocket("/ws/video/ingest/{camera_id}")
async def ingest_video(websocket: WebSocket, camera_id: str) -> None:
    settings = websocket.app.state.settings
    if not is_valid_ingest_key(settings, websocket.headers.get("x-api-key")):
        await websocket.close(code=POLICY_VIOLATION, reason="Invalid or missing API key")
        return

    await websocket.accept()
    hub = _hub(websocket)
    feed = await hub.attach(camera_id, owner=websocket)
    logger.info("Video ingest started for %s", camera_id)
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            frame = message.get("bytes")
            if not frame or not frame.startswith(JPEG_MAGIC):
                await websocket.close(code=UNSUPPORTED_DATA, reason="Frames must be binary JPEG")
                break
            if len(frame) > settings.max_frame_bytes:
                await websocket.close(code=MESSAGE_TOO_BIG, reason="Frame too large")
                break
            await feed.publish(frame)
    except WebSocketDisconnect:
        pass
    finally:
        await hub.detach(camera_id, owner=websocket)
        logger.info("Video ingest stopped for %s", camera_id)


# --- FastAPI -> React ------------------------------------------------------


@router.get("/api/v1/video", response_model=VideoCamerasResponse)
async def list_cameras(request: Request) -> VideoCamerasResponse:
    return VideoCamerasResponse(cameras=_hub(request).describe())


@router.get(
    "/api/v1/video/{camera_id}",
    response_class=StreamingResponse,
    responses={
        200: {"content": {f"multipart/x-mixed-replace; boundary={BOUNDARY}": {}}},
        404: {"description": "Camera is not streaming"},
    },
)
async def stream_video(request: Request, camera_id: str) -> StreamingResponse:
    feed = _get_feed(request, camera_id)

    async def mjpeg() -> AsyncIterator[bytes]:
        version = 0
        while True:
            result = await feed.next_frame(version, timeout=KEEPALIVE_SECONDS)
            if result is None:
                return  # camera stopped streaming
            frame, version = result
            yield (
                f"--{BOUNDARY}\r\n"
                "Content-Type: image/jpeg\r\n"
                f"Content-Length: {len(frame)}\r\n\r\n"
            ).encode() + frame + b"\r\n"

    return StreamingResponse(
        mjpeg(),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/api/v1/video/{camera_id}/snapshot",
    response_class=Response,
    responses={
        200: {"content": {"image/jpeg": {}}},
        404: {"description": "Camera is not streaming"},
    },
)
async def snapshot(request: Request, camera_id: str) -> Response:
    feed = _get_feed(request, camera_id)
    return Response(feed.frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
