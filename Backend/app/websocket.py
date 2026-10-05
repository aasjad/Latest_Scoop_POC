"""Tracks connected dashboard clients and broadcasts live events to them."""

import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)

SEND_TIMEOUT_SECONDS = 5


class ConnectionManager:
    """In-memory registry of WebSocket clients.

    Lives in a single process: run uvicorn with one worker, or replace this with a
    shared pub/sub (e.g. Redis) before scaling out.
    """

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    @property
    def count(self) -> int:
        return len(self._connections)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        logger.info("WebSocket client connected (%d total)", self.count)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)
        logger.info("WebSocket client disconnected (%d total)", self.count)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            targets = list(self._connections)
        if not targets:
            return

        async def send(ws: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(ws.send_json(message), SEND_TIMEOUT_SECONDS)
                return None
            except Exception:  # closed socket, timeout, slow client
                return ws

        failed = [ws for ws in await asyncio.gather(*(send(ws) for ws in targets)) if ws]
        for ws in failed:
            await self.disconnect(ws)
