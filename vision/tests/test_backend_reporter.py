"""
Tests for reporting counted crossings to the backend, with a fake HTTP server
standing in for FastAPI - no camera, no model, no real backend. Run from the
vision folder:

    python -m pytest tests -q

Covers: payloads sent to /api/v1/events and /api/v1/incidents, the snapshot
written to disk, one report per crossing (not per frame) while a person
loiters on the line, and an unreachable backend not breaking counting.
"""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import person_counter  # noqa: E402,F401  (sets FFmpeg env before cv2 loads)
from person_counter.app import CountPipeline  # noqa: E402
from person_counter.backend_reporter import BackendReporter, StatusReporter  # noqa: E402
from person_counter.counting_line import CountingLine  # noqa: E402
from person_counter.detector import Detection  # noqa: E402

FRAME = np.zeros((480, 640, 3), dtype=np.uint8)


class FakeBackend:
    """Records POSTed JSON bodies and answers like the real API."""

    def __init__(self):
        self.posts: list[tuple[str, dict]] = []
        backend = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _reply(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                self._reply(200, {"status": "healthy"})

            def do_PUT(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                backend.posts.append((self.path, body))
                self.send_response(204)
                self.end_headers()

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                backend.posts.append((self.path, body))
                if self.path == "/api/v1/incidents":
                    self._reply(201, {"id": len(backend.posts), **body})
                else:
                    self._reply(201, {"success": True, "event_id": body.get("event_id")})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def paths(self):
        return [p for p, _ in self.posts]


@pytest.fixture
def backend():
    fake = FakeBackend()
    yield fake
    fake.server.shutdown()


class ScriptedDetector:
    """Stands in for PersonDetector: returns pre-made tracked detections."""

    def __init__(self, frames):
        self.frames = iter(frames)

    def track(self, frame):
        return next(self.frames)


def person_at(track_id, foot_y):
    return Detection(300, foot_y - 120, 340, foot_y, 0.9, track_id=track_id)


def make_pipeline(frames, reporter):
    # Horizontal line at y=240; side +1 (below it, larger y) is ENTRY.
    line = CountingLine(0, 240, 640, 240, entry_side=1)
    return CountPipeline(ScriptedDetector(frames), line, show_trails=False, reporter=reporter)


def test_crossing_is_reported_as_event_and_incident(backend, tmp_path):
    reporter = BackendReporter(base_url=backend.url, camera_id="CAM_TEST", image_dir=tmp_path)
    assert reporter.check_connection()

    # Walk from y=150 (above) to y=330 (below): one ENTRY.
    frames = [[person_at(7, y)] for y in range(150, 331, 10)]
    pipeline = make_pipeline(frames, reporter)
    for _ in frames:
        pipeline.process(FRAME.copy())
    reporter.close()

    assert pipeline.counter.entry_count == 1
    assert backend.paths() == ["/api/v1/events", "/api/v1/incidents"]

    event = backend.posts[0][1]
    assert event["camera_id"] == "CAM_TEST"
    assert event["track_id"] == 7 and event["direction"] == "ENTRY"
    assert event["timestamp"].endswith("Z")

    incident = backend.posts[1][1]
    assert set(incident) == {"camera_id", "person_id", "event_type", "severity",
                             "description", "timestamp", "image_path"}
    assert incident["person_id"] == 7
    assert incident["event_type"] == config.CROSSING_EVENT_TYPE
    assert incident["severity"] == config.CROSSING_SEVERITY
    assert "\\" not in incident["image_path"]  # never a raw Windows path

    saved = list(tmp_path.glob("incident_CAM_TEST_*_7_*.jpg"))
    assert len(saved) == 1 and saved[0].stat().st_size > 0
    assert incident["image_path"].endswith(saved[0].name)


def test_loitering_on_the_line_reports_once_not_every_frame(backend, tmp_path):
    reporter = BackendReporter(base_url=backend.url, image_dir=tmp_path)
    rng = np.random.default_rng(0)

    # Approach, then 300 frames jittering +-8 px on the line, then walk through.
    frames = [[person_at(3, y)] for y in range(150, 231, 10)]
    frames += [[person_at(3, 240 + int(rng.integers(-8, 9)))] for _ in range(300)]
    frames += [[person_at(3, y)] for y in range(250, 331, 10)]

    pipeline = make_pipeline(frames, reporter)
    for _ in frames:
        pipeline.process(FRAME.copy())
    reporter.close()

    assert pipeline.counter.entry_count == 1
    assert backend.paths().count("/api/v1/incidents") == 1


def test_unreachable_backend_does_not_break_counting(tmp_path):
    # Nothing listens on port 9: every request fails fast.
    reporter = BackendReporter(base_url="http://127.0.0.1:9", image_dir=tmp_path)
    assert reporter.check_connection() is False

    frames = [[person_at(5, y)] for y in range(150, 331, 10)]
    pipeline = make_pipeline(frames, reporter)
    for _ in frames:
        pipeline.process(FRAME.copy())
    reporter.close()

    assert pipeline.counter.entry_count == 1
    assert reporter.failed == 1 and reporter.sent == 0
    assert list(tmp_path.glob("*.jpg")) == []  # no orphaned snapshot


def test_no_reporter_means_no_reports(backend):
    frames = [[person_at(5, y)] for y in range(150, 331, 10)]
    pipeline = make_pipeline(frames, reporter=None)
    for _ in frames:
        pipeline.process(FRAME.copy())
    assert pipeline.counter.entry_count == 1
    assert backend.posts == []


# --- status heartbeat -----------------------------------------------------------


class FakeLiveStream:
    """The attributes StatusReporter reads from a ThreadedVideoStream."""

    width, height = 640, 480
    frames_ingested = 0
    last_frame_age = 0.08
    drop_rate = 55.0


def test_heartbeat_reports_measured_state(backend, monkeypatch):
    monkeypatch.setattr(config, "HEARTBEAT_SECONDS", 3600)  # beats driven by hand below
    status = StatusReporter("count", "rtsp://admin:secret@10.0.0.5:554/stream1",
                            base_url=backend.url, camera_id="CAM_T")
    stream = FakeLiveStream()
    status.attach_stream(stream)

    first = status.payload()
    assert first["camera_state"] == "connecting"            # no frame yet
    assert first["model"] is None and first["tracker_active"] is False
    assert first["name"] == "10.0.0.5"
    assert "secret" not in first["source"]
    assert first["resolution"] == "640 × 480"

    frames = [[person_at(1, 150)]]
    pipeline = make_pipeline(frames, reporter=None)
    status.pipeline_ready(pipeline)
    stream.frames_ingested = 50
    status.frame_processed(fps=11.0, process_ms=85.0)
    beat = status.payload()
    assert beat["camera_state"] == "streaming"
    assert beat["model"] == config.MODEL_PATH and beat["tracker_active"] is True
    assert beat["inference_fps"] == 11.0 and beat["latency_ms"] == 80
    assert beat["frame_drop_pct"] == 55.0
    # Line y=240 across the full width of a 640x480 frame, entry_side=+1 -> A_TO_B.
    assert beat["config"]["line"] == {"p1": {"x": 0.0, "y": 0.5}, "p2": {"x": 1.0, "y": 0.5}}
    assert beat["config"]["entry_direction"] == "A_TO_B"

    assert status.payload()["camera_state"] == "stalled"     # no new frames since last beat

    status.close()
    beats = [b for p, b in backend.posts if p == "/api/v1/cameras/CAM_T/heartbeat"]
    assert beats and beats[-1]["camera_state"] == "stopped"


def test_view_mode_has_no_model_tracker_or_line(backend, monkeypatch):
    from person_counter.app import ViewPipeline
    monkeypatch.setattr(config, "HEARTBEAT_SECONDS", 3600)
    status = StatusReporter("view", "clip.mp4", base_url=backend.url)
    status.attach_stream(FakeLiveStream())
    status.pipeline_ready(ViewPipeline())
    beat = status.payload()
    assert beat["model"] is None and beat["tracker_active"] is False and beat["config"] is None
    assert beat["name"] == "clip.mp4"
    status.close()


def test_flipped_line_maps_to_b_to_a(backend, monkeypatch):
    monkeypatch.setattr(config, "HEARTBEAT_SECONDS", 3600)
    status = StatusReporter("count", "clip.mp4", base_url=backend.url)
    status.attach_stream(FakeLiveStream())
    pipeline = make_pipeline([], reporter=None)
    pipeline.counter.line.flip()
    status.pipeline_ready(pipeline)
    assert status.payload()["config"]["entry_direction"] == "B_TO_A"
    status.close()


def test_heartbeat_failure_does_not_raise(monkeypatch):
    monkeypatch.setattr(config, "HEARTBEAT_SECONDS", 3600)
    status = StatusReporter("count", "clip.mp4", base_url="http://127.0.0.1:9")
    status.close()   # beats fail; nothing propagates
