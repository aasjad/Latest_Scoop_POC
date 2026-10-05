"""WebSocket /ws/events: pushes PERSON_COUNT_EVENT messages to the dashboard."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/events")
async def events_socket(websocket: WebSocket) -> None:
    manager = websocket.app.state.manager
    await manager.connect(websocket)
    try:
        # The channel is server -> client. We still read so disconnects are detected,
        # and answer "ping" so the frontend can use it as a keep-alive.
        while True:
            text = await websocket.receive_text()
            if text == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
