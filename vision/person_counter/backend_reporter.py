"""
backend_reporter.py
===================

Sends what Vision sees and does to the FastAPI backend.

BackendReporter - one report per counted crossing (count mode):

For every line crossing the counter books (one per crossing - PersonCounter's
state machine already guarantees that), this:

    1. saves a JPEG snapshot of the frame into incidents/images/
    2. POSTs the crossing to   /api/v1/events     (entry/exit counts, dashboard)
    3. POSTs an incident to    /api/v1/incidents  (incident log, with image_path)

StatusReporter - a heartbeat every HEARTBEAT_SECONDS (every mode): camera
state, FPS, lag, drops, the loaded model, whether the tracker runs, and the
counting line. The dashboard's Camera / AI Engine / Tracker status comes from
these heartbeats; when they stop, the backend marks the camera offline.

The backend owns the database; this module never touches SQLite.

Why a background thread
-----------------------
The display loop runs at ~10 FPS and must not wait on the network. A slow or
absent backend would otherwise freeze the video for the length of every HTTP
timeout. So report_crossing() only copies the frame and queues it; JPEG
encoding, disk writes and HTTP all happen on a worker thread. If the backend is
down, the failure is printed and counting carries on untouched.
"""

import json
import queue
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request
from urllib.parse import urlsplit

import cv2

import config


@dataclass
class _Crossing:
    frame: object          # a private copy of the annotated frame
    track_id: int
    direction: str         # "entry" / "exit", as PersonCounter reports it
    when: datetime


_STOP = object()


class BackendReporter:
    """Queues crossings and reports them to the backend from a worker thread."""

    def __init__(self, base_url: str | None = None, camera_id: str | None = None,
                 image_dir: str | Path | None = None):
        self.base_url = (base_url or config.BACKEND_URL).rstrip("/")
        self.camera_id = camera_id or config.CAMERA_ID
        self.image_dir = Path(image_dir or config.INCIDENT_IMAGE_DIR)
        self.image_dir.mkdir(parents=True, exist_ok=True)

        self.sent = 0
        self.failed = 0
        # Bounded: if the backend is unreachable for a long time we drop the
        # oldest work rather than letting frames pile up in memory.
        self._queue: queue.Queue = queue.Queue(maxsize=100)
        self._worker = threading.Thread(target=self._run, name="backend-reporter", daemon=True)
        self._worker.start()

    # --- called from the display loop ------------------------------------

    def check_connection(self) -> bool:
        """Print whether the backend answers, so a missing server is obvious at start-up."""
        try:
            self._request("GET", "/api/v1/health")
            print(f"Backend: connected at {self.base_url} (camera_id={self.camera_id})")
            return True
        except Exception as exc:  # noqa: BLE001 - any failure means "not reachable"
            print(f"Backend: NOT reachable at {self.base_url} ({_reason(exc)}). "
                  f"Counting continues; incidents are not stored until it is up.")
            return False

    def report_crossing(self, frame, track_id: int, direction: str):
        """Queue one crossing. Cheap: a frame copy, no I/O."""
        crossing = _Crossing(frame.copy(), int(track_id), direction, datetime.now(timezone.utc))
        try:
            self._queue.put_nowait(crossing)
        except queue.Full:
            self.failed += 1
            print(f"Backend: report queue full - crossing of person #{track_id} dropped")

    def close(self, timeout: float = 10.0):
        """Send whatever is still queued (up to `timeout` seconds), then stop."""
        self._queue.put(_STOP)
        self._worker.join(timeout)
        if self._worker.is_alive():
            print("Backend: gave up waiting for queued reports to send.")
        print(f"Backend: {self.sent} incident(s) reported, {self.failed} failed.")

    # --- worker thread -----------------------------------------------------

    def _run(self):
        while True:
            item = self._queue.get()
            if item is _STOP:
                return
            try:
                self._send(item)
                self.sent += 1
            except Exception as exc:  # noqa: BLE001 - never kill the worker
                self.failed += 1
                print(f"Backend: failed to report person #{item.track_id} "
                      f"to {self.base_url}: {_reason(exc)}")

    def _send(self, c: _Crossing):
        timestamp = c.when.strftime("%Y-%m-%dT%H:%M:%SZ")
        direction = "ENTRY" if c.direction == "entry" else "EXIT"
        stamp = c.when.strftime("%Y%m%dT%H%M%S")
        suffix = uuid.uuid4().hex[:6]

        image_file = self.image_dir / f"incident_{self.camera_id}_{stamp}_{c.track_id}_{suffix}.jpg"
        image_path = self._save_image(c.frame, image_file)
        try:
            self._post(c, timestamp, direction, f"{stamp}-{c.track_id}-{suffix}", image_path)
        except Exception:
            # No incident refers to the snapshot, so don't leave it orphaned on disk.
            image_file.unlink(missing_ok=True)
            raise

    def _post(self, c: _Crossing, timestamp: str, direction: str, key: str, image_path: str | None):
        # Entry/exit count. 409 means it is already stored, which is success.
        try:
            self._request("POST", "/api/v1/events", {
                "event_id": f"{self.camera_id}-{key}",
                "camera_id": self.camera_id,
                "track_id": c.track_id,
                "direction": direction,
                "timestamp": timestamp,
            })
        except error.HTTPError as exc:
            if exc.code != 409:
                raise

        incident = self._request("POST", "/api/v1/incidents", {
            "camera_id": self.camera_id,
            "person_id": c.track_id,
            "event_type": config.CROSSING_EVENT_TYPE,
            "severity": config.CROSSING_SEVERITY,
            "description": f"Person #{c.track_id} crossed the counting line ({direction})",
            "timestamp": timestamp,
            "image_path": image_path,
        })
        print(f"Backend: incident #{incident['id']} stored - person #{c.track_id} {direction}")

    def _save_image(self, frame, target: Path) -> str | None:
        """Write the snapshot; return its path as the backend expects it, or None."""
        if not cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, 85]):
            print(f"Backend: could not write snapshot {target}; reporting without image")
            return None
        # Project-relative, forward slashes: the backend resolves it against the
        # project root and never sees a machine-specific Windows path.
        try:
            return target.resolve().relative_to(config.PROJECT_ROOT).as_posix()
        except ValueError:
            return target.resolve().as_posix()

    def _request(self, method: str, path: str, body: dict | None = None):
        return _http(self.base_url, method, path, body)


def _http(base_url: str, method: str, path: str, body: dict | None = None,
          timeout: float | None = None):
    """One JSON request to the backend; raises on any HTTP or network error."""
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if config.BACKEND_API_KEY:
        headers["X-API-Key"] = config.BACKEND_API_KEY
    req = request.Request(base_url + path, data=data, headers=headers, method=method)
    with request.urlopen(req, timeout=timeout or config.BACKEND_TIMEOUT_SECONDS) as resp:
        payload = resp.read()
    return json.loads(payload) if payload else None


def _reason(exc: Exception) -> str:
    """A one-line explanation, including the backend's own error detail if any."""
    if isinstance(exc, error.HTTPError):
        try:
            detail = json.loads(exc.read()).get("detail")
        except Exception:  # noqa: BLE001
            detail = None
        return f"HTTP {exc.code}" + (f": {detail}" if detail else "")
    if isinstance(exc, error.URLError):
        return f"connection failed ({exc.reason})"
    return f"{type(exc).__name__}: {exc}"


class StatusReporter:
    """Heartbeat to the backend: what this Vision process is actually doing.

    Everything sent is measured, not assumed:
      camera_state  from frames arriving (the ingest thread's counter for live
                    cameras, processed frames for files)
      model/tracker from the pipeline that was actually built
      config        the counting line in use, normalized to 0..1
    Runs on its own thread; a backend that is down is reported once, not every beat.
    """

    def __init__(self, mode: str, source: str, base_url: str | None = None,
                 camera_id: str | None = None):
        self.base_url = (base_url or config.BACKEND_URL).rstrip("/")
        self.camera_id = camera_id or config.CAMERA_ID
        self.mode = mode
        self.source = source
        self.started_at = time.time()

        self.stream = None
        self.resolution = None
        self.model = None
        self.tracker_active = False
        self.line_config = None

        # Updated by the display loop after every processed frame.
        self.frames_processed = 0
        self.inference_fps = 0.0
        self.process_ms = 0.0
        # People the tracker follows in the latest frame (len of live IDs).
        self.active_tracks = 0

        self._stop = threading.Event()
        self._ok: bool | None = None       # last heartbeat outcome, for change-only logging
        self._prev = None                  # (time, frame counter) at the previous beat
        self._thread = threading.Thread(target=self._loop, name="backend-heartbeat", daemon=True)
        self._thread.start()

    # --- called from the display loop ------------------------------------

    def attach_stream(self, stream):
        self.stream = stream
        if stream.width and stream.height:
            self.resolution = f"{stream.width} × {stream.height}"

    def pipeline_ready(self, pipeline):
        """Record what was really loaded: model, tracker, counting line."""
        self.model = config.MODEL_PATH if hasattr(pipeline, "detector") else None
        self.tracker_active = hasattr(pipeline, "trails")       # track and count pipelines
        counter = getattr(pipeline, "counter", None)
        if counter is not None and self.stream is not None and self.stream.width:
            self.line_config = _line_config(counter.line, self.stream.width, self.stream.height)

    def frame_processed(self, fps: float, process_ms: float, active_tracks: int = 0):
        self.frames_processed += 1
        self.inference_fps = fps
        self.process_ms = process_ms
        self.active_tracks = active_tracks

    def line_changed(self, counter_line, width: int, height: int):
        """The counting line was replaced at runtime (from the dashboard)."""
        self.line_config = _line_config(counter_line, width, height)

    def close(self):
        """Stop beating and tell the backend Vision is gone, so it is offline at once."""
        self._stop.set()
        self._thread.join(config.BACKEND_TIMEOUT_SECONDS + 1)
        self._beat(stopping=True)

    # --- heartbeat thread --------------------------------------------------

    def _loop(self):
        # payload() is only ever called from this thread until close() has
        # joined it, so the frame-rate bookkeeping needs no lock.
        while not self._stop.wait(config.HEARTBEAT_SECONDS):
            self._beat()

    def _frame_counter(self) -> int:
        # Live cameras: frames the ingest thread received, whether or not
        # inference kept up. Files: frames actually processed.
        return getattr(self.stream, "frames_ingested", self.frames_processed)

    def payload(self, stopping: bool = False) -> dict:
        now = time.time()
        frames = self._frame_counter()
        prev_time, prev_frames = self._prev or (self.started_at, 0)
        self._prev = (now, frames)
        new_frames = frames - prev_frames
        elapsed = max(now - prev_time, 1e-6)

        if stopping:
            camera_state = "stopped"
        elif frames == 0:
            camera_state = "connecting"
        else:
            camera_state = "streaming" if new_frames > 0 else "stalled"

        latency = getattr(self.stream, "last_frame_age", None)
        latency_ms = latency * 1000 if latency is not None else self.process_ms
        processing = self.frames_processed and camera_state == "streaming"
        return {
            "name": config.CAMERA_NAME or _camera_name(self.source),
            "location": config.CAMERA_LOCATION,
            "source": public_source(self.source),
            "resolution": self.resolution,
            "mode": self.mode,
            "model": self.model,
            "tracker_active": self.tracker_active,
            "camera_state": camera_state,
            "camera_fps": round(new_frames / elapsed, 1),
            "inference_fps": round(self.inference_fps, 1) if processing else 0.0,
            "latency_ms": int(latency_ms) if processing else 0,
            "frame_drop_pct": round(min(max(getattr(self.stream, "drop_rate", 0.0), 0.0), 100.0), 1),
            "uptime_s": int(now - self.started_at),
            # Only meaningful while frames are being processed.
            "active_tracks": self.active_tracks if processing else 0,
            "config": self.line_config,
        }

    def _beat(self, stopping: bool = False):
        try:
            _http(self.base_url, "PUT", f"/api/v1/cameras/{self.camera_id}/heartbeat", self.payload(stopping))
            if self._ok is not True:
                print(f"Backend: status heartbeat OK ({self.camera_id} -> {self.base_url})")
            self._ok = True
        except Exception as exc:  # noqa: BLE001 - never kill the heartbeat
            if self._ok is not False:
                print(f"Backend: status heartbeat failing ({_reason(exc)}); "
                      f"dashboard will show this camera offline until it recovers")
            self._ok = False


def _line_config(line, width: int, height: int) -> dict:
    """The counting line as the dashboard describes it.

    Same sign convention on both sides: the cross product is positive on side
    B, and entry_side +1 means "crossing INTO the positive side is an entry",
    i.e. A_TO_B.
    """
    def point(x, y):
        return {"x": min(max(x / width, 0.0), 1.0), "y": min(max(y / height, 0.0), 1.0)}

    return {
        "line": {"p1": point(line.x1, line.y1), "p2": point(line.x2, line.y2)},
        "entry_direction": "A_TO_B" if line.entry_side == 1 else "B_TO_A",
        "detection_confidence": config.TRACK_CONF_THRESHOLD,
    }


def _camera_name(source: str) -> str:
    """The camera's host for a network stream, the file name for a recording."""
    parts = urlsplit(source)
    if parts.hostname:
        return parts.hostname
    return Path(source).name or source


def public_source(source: str) -> str:
    """The source with any user name and password removed - safe to send anywhere."""
    parts = urlsplit(source)
    if parts.username is None and parts.password is None:
        return source
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    return parts._replace(netloc=host).geturl()
