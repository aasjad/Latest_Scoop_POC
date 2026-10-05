"""
live_link.py
============

The two long-lived links between Vision and the backend, besides the
heartbeat and the crossing reports in backend_reporter.py:

VideoPublisher
    Pushes the frame Vision shows in its own window (boxes, IDs, counting
    line, HUD) to the backend's video relay, WebSocket
    /ws/video/ingest/{camera_id}, one JPEG per message. The backend serves it to
    browsers as MJPEG. Vision stays the only thing connected to the camera.

    Like ThreadedVideoStream it keeps a SINGLE slot: publish() overwrites the
    newest frame, the sender thread encodes and sends whatever is newest when
    it is free. Nothing queues, so a slow network costs frames, never latency
    or memory. The rate is capped at VIDEO_MAX_FPS.

CommandListener
    Long-polls GET /api/v1/cameras/{id}/commands/next for changes made in the
    dashboard (a new counting line / entry direction / confidence). It does
    NOT apply them: the frame loop does, between two frames, by calling
    take() - so the counter is never changed under the tracker's feet. The
    loop's answer goes back to the backend, which only then tells the
    dashboard the change was saved.
"""

import threading
import time

import cv2

import config
from .backend_reporter import _http, _reason

try:
    from websockets.sync.client import connect as ws_connect
except ImportError:  # pragma: no cover - reported at start-up instead
    ws_connect = None


class VideoPublisher:
    def __init__(self, base_url: str | None = None, camera_id: str | None = None):
        base = (base_url or config.BACKEND_URL).rstrip("/")
        self.camera_id = camera_id or config.CAMERA_ID
        self.url = base.replace("http://", "ws://", 1).replace("https://", "wss://", 1) \
            + f"/ws/video/ingest/{self.camera_id}"
        self.sent = 0

        self._cond = threading.Condition()
        self._frame = None        # the single slot - newest frame only
        self._seq = 0
        self._stop = False
        self._connected: bool | None = None
        self._thread = None
        if ws_connect is None:
            print("Video to backend: OFF - install the 'websockets' package "
                  "(pip install -r requirements.txt)")
            return
        self._thread = threading.Thread(target=self._run, name="video-publisher", daemon=True)
        self._thread.start()

    def publish(self, frame):
        """Offer the newest displayed frame. Cheap: a copy into the slot."""
        if self._thread is None:
            return
        with self._cond:
            self._frame = frame.copy()
            self._seq += 1
            self._cond.notify()

    def close(self):
        if self._thread is None:
            return
        with self._cond:
            self._stop = True
            self._cond.notify()
        self._thread.join(3)

    # --- sender thread -----------------------------------------------------

    def _next_frame(self, last_seq: int):
        with self._cond:
            while not self._stop and self._seq == last_seq:
                self._cond.wait(1.0)
            if self._stop:
                return None, last_seq
            return self._frame, self._seq

    def _encode(self, frame) -> bytes | None:
        height, width = frame.shape[:2]
        if width > config.VIDEO_MAX_WIDTH:
            scale = config.VIDEO_MAX_WIDTH / width
            frame = cv2.resize(frame, (config.VIDEO_MAX_WIDTH, int(height * scale)), interpolation=cv2.INTER_AREA)
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, config.VIDEO_JPEG_QUALITY])
        return jpeg.tobytes() if ok else None

    def _run(self):
        headers = {"X-API-Key": config.BACKEND_API_KEY} if config.BACKEND_API_KEY else None
        min_interval = 1.0 / config.VIDEO_MAX_FPS
        seq = 0
        while not self._stop:
            try:
                with ws_connect(self.url, additional_headers=headers, open_timeout=5,
                                max_size=None, compression=None) as ws:
                    if self._connected is not True:
                        print(f"Video to backend: streaming to {self.url}")
                    self._connected = True
                    last_sent = 0.0
                    while not self._stop:
                        frame, seq = self._next_frame(seq)
                        if frame is None:
                            break
                        wait = min_interval - (time.monotonic() - last_sent)
                        if wait > 0:
                            time.sleep(wait)       # rate cap; newer frames replace this one meanwhile
                            frame, seq = self._frame, self._seq
                        data = self._encode(frame)
                        if data:
                            ws.send(data)
                            self.sent += 1
                            last_sent = time.monotonic()
            except Exception as exc:  # noqa: BLE001 - reconnect on any failure
                if self._connected is not False:
                    print(f"Video to backend: not connected ({type(exc).__name__}: {exc}); retrying")
                self._connected = False
                for _ in range(int(config.RECONNECT_DELAY_SECONDS * 10)):
                    if self._stop:
                        break
                    time.sleep(0.1)


class CommandListener:
    """Collects dashboard changes for the frame loop to apply."""

    POLL_WAIT_SECONDS = 20

    def __init__(self, base_url: str | None = None, camera_id: str | None = None):
        self.base_url = (base_url or config.BACKEND_URL).rstrip("/")
        self.camera_id = camera_id or config.CAMERA_ID
        self._lock = threading.Lock()
        self._pending = None            # command waiting for the frame loop
        self._done = threading.Event()
        self._result = None
        self._stop = threading.Event()
        self._ok: bool | None = None
        self._thread = threading.Thread(target=self._run, name="backend-commands", daemon=True)
        self._thread.start()

    # --- frame loop side -----------------------------------------------------

    def take(self):
        """The command to apply now, or None. Called once per frame."""
        with self._lock:
            command, self._pending = self._pending, None
        return command

    def complete(self, command: dict, ok: bool, config_applied: dict | None = None, error_text: str | None = None):
        self._result = {"ok": ok, "config": config_applied, "error": error_text}
        self._done.set()

    def close(self):
        self._stop.set()

    # --- polling thread --------------------------------------------------------

    def _run(self):
        while not self._stop.is_set():
            try:
                command = _http(self.base_url, "GET",
                                f"/api/v1/cameras/{self.camera_id}/commands/next?wait={self.POLL_WAIT_SECONDS}",
                                timeout=self.POLL_WAIT_SECONDS + 5)
                if self._ok is not True and self._ok is not None:
                    print("Backend: command channel restored")
                self._ok = True
            except Exception as exc:  # noqa: BLE001
                if self._ok is not False:
                    print(f"Backend: command channel unavailable ({_reason(exc)}); "
                          f"dashboard line changes cannot reach Vision until it is back")
                self._ok = False
                self._stop.wait(config.RECONNECT_DELAY_SECONDS)
                continue
            if not command:
                continue  # 204: nothing to do, poll again
            print(f"Backend: dashboard requested {command.get('type')} ({command.get('command_id')})")
            self._done.clear()
            with self._lock:
                self._pending = command
            if not self._done.wait(config.COMMAND_APPLY_TIMEOUT_SECONDS):
                # The frame loop did not get to it (paused, still loading, line setup...).
                with self._lock:
                    if self._pending is command:
                        self._pending = None
                self._result = {"ok": False, "config": None,
                                "error": "Vision is busy and could not apply the change (no frame processed)"}
            try:
                _http(self.base_url, "POST",
                      f"/api/v1/cameras/{self.camera_id}/commands/{command['command_id']}/result", self._result)
            except Exception as exc:  # noqa: BLE001
                print(f"Backend: could not confirm command {command['command_id']}: {_reason(exc)}")
