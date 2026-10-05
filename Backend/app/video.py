"""Relays live camera frames from the AI Engine to dashboard viewers.

Only the latest frame per camera is kept, in memory. Viewers always get the newest
frame, so a slow viewer skips frames instead of falling behind or slowing others.
Nothing is written to disk or SQLite.
"""

import asyncio
from datetime import datetime, timezone
from typing import Optional

from app.schemas import to_utc_string


class CameraFeed:
    def __init__(self, camera_id: str) -> None:
        self.camera_id = camera_id
        self.frame: Optional[bytes] = None
        self.version = 0
        self.last_frame_at: Optional[datetime] = None
        self.closed = False
        self._cond = asyncio.Condition()

    async def publish(self, frame: bytes) -> None:
        async with self._cond:
            self.frame = frame
            self.version += 1
            self.last_frame_at = datetime.now(timezone.utc)
            self._cond.notify_all()

    async def close(self) -> None:
        async with self._cond:
            self.closed = True
            self._cond.notify_all()

    async def next_frame(self, after_version: int, timeout: float) -> Optional[tuple[bytes, int]]:
        """Wait for a frame newer than `after_version`.

        Returns None once the feed is closed. On timeout, returns the current frame
        again so the caller can still write to (and detect) a dead viewer connection.
        """
        async with self._cond:
            try:
                await asyncio.wait_for(
                    self._cond.wait_for(lambda: self.closed or self.version > after_version),
                    timeout,
                )
            except asyncio.TimeoutError:
                pass
            if self.closed or self.frame is None:
                return None
            return self.frame, self.version


class FrameHub:
    """Live feeds by camera_id. A feed exists while its AI Engine connection is open."""

    def __init__(self) -> None:
        self._feeds: dict[str, CameraFeed] = {}
        # The connection currently publishing each camera, so a stale connection
        # closing late can't end the feed of a newer one that replaced it.
        self._owners: dict[str, object] = {}

    def get(self, camera_id: str) -> Optional[CameraFeed]:
        return self._feeds.get(camera_id)

    def feeds(self) -> list[CameraFeed]:
        return list(self._feeds.values())

    async def attach(self, camera_id: str, owner: object) -> CameraFeed:
        feed = self._feeds.get(camera_id)
        if feed is None or feed.closed:
            feed = CameraFeed(camera_id)
            self._feeds[camera_id] = feed
        self._owners[camera_id] = owner
        return feed

    async def detach(self, camera_id: str, owner: object) -> None:
        if self._owners.get(camera_id) is not owner:
            return  # a newer connection took over this camera
        del self._owners[camera_id]
        feed = self._feeds.pop(camera_id, None)
        if feed is not None:
            await feed.close()

    def describe(self) -> list[dict]:
        return [
            {
                "camera_id": feed.camera_id,
                "last_frame_at": to_utc_string(feed.last_frame_at) if feed.last_frame_at else None,
            }
            for feed in sorted(self._feeds.values(), key=lambda f: f.camera_id)
        ]
