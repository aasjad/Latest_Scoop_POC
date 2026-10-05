"""
Tests for the live links to the backend - no camera, no model:

  * apply_command: a dashboard line change really replaces the counter's line,
    is saved to the camera's line file, and is refused when invalid
  * active tracks reach the heartbeat
  * VideoPublisher sends JPEGs over a real WebSocket, newest frame only
  * CommandListener: command -> frame loop -> result posted back

Run from the vision folder:  python -m pytest tests -q
"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import person_counter  # noqa: E402,F401
from person_counter.app import CountPipeline, ViewPipeline, apply_command  # noqa: E402
from person_counter.backend_reporter import StatusReporter  # noqa: E402
from person_counter.counting_line import CountingLine, line_path_for  # noqa: E402
from person_counter.live_link import CommandListener, VideoPublisher  # noqa: E402
from test_backend_reporter import FakeLiveStream, ScriptedDetector, person_at  # noqa: E402

FRAME = np.zeros((480, 640, 3), dtype=np.uint8)


class FakeStream(FakeLiveStream):
    source = "rtsp://admin:secret@10.0.0.5:554/stream1"


def command(p1, p2, direction="B_TO_A", conf=0.2):
    return {"command_id": "a" * 32, "type": "SET_LINE",
            "config": {"line": {"p1": p1, "p2": p2}, "entry_direction": direction, "detection_confidence": conf}}


@pytest.fixture
def line_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "LINE_DIR", str(tmp_path))
    monkeypatch.setattr(config, "TRACK_CONF_THRESHOLD", config.TRACK_CONF_THRESHOLD)
    return tmp_path


def make_pipeline(frames):
    return CountPipeline(ScriptedDetector(frames), CountingLine(0, 240, 640, 240, entry_side=1), show_trails=False)


# --- apply_command -----------------------------------------------------------------


def test_apply_command_replaces_line_and_persists(line_dir):
    # Vertical line at x=320; B_TO_A -> entry_side -1.
    frames = [[person_at(7, 150)]]
    pipeline = make_pipeline(frames)
    pipeline.process(FRAME.copy())
    assert pipeline.counter.states            # a track remembered its side of the OLD line

    stream = FakeStream()
    ok, applied, err = apply_command(command({"x": 0.5, "y": 0.1}, {"x": 0.5, "y": 0.9}), pipeline, stream)
    assert ok and err is None
    line = pipeline.counter.line
    assert (line.x1, line.y1, line.x2, line.y2, line.entry_side) == (320, 48, 320, 432, -1)
    assert pipeline.counter.states == {}      # no phantom crossing from the switch
    assert config.TRACK_CONF_THRESHOLD == 0.2
    assert applied["entry_direction"] == "B_TO_A"
    assert applied["line"] == {"p1": {"x": 0.5, "y": 0.1}, "p2": {"x": 0.5, "y": 0.9}}

    # Saved where Vision looks for this camera's line on the next start.
    saved = CountingLine.load(line_path_for(stream.source), frame_size=(640, 480))
    assert (saved.x1, saved.y1, saved.x2, saved.y2, saved.entry_side) == (320, 48, 320, 432, -1)


def test_new_line_is_what_counts(line_dir):
    # Crossing the OLD horizontal line (y=240) must not count after a switch to a vertical line.
    frames = [[person_at(3, y)] for y in range(150, 331, 10)]
    pipeline = make_pipeline(frames)
    apply_command(command({"x": 0.05, "y": 0.0}, {"x": 0.05, "y": 0.99}), pipeline, FakeStream())
    for _ in frames:
        pipeline.process(FRAME.copy())
    assert pipeline.counter.entry_count == 0 and pipeline.counter.exit_count == 0


def test_apply_command_refuses_short_line_and_other_modes(line_dir):
    pipeline = make_pipeline([])
    before = pipeline.counter.line
    ok, applied, err = apply_command(command({"x": 0.5, "y": 0.5}, {"x": 0.51, "y": 0.5}), pipeline, FakeStream())
    assert not ok and "shorter" in err and applied is None
    assert pipeline.counter.line is before
    assert not os.listdir(line_dir)           # nothing saved

    ok, _, err = apply_command(command({"x": 0.1, "y": 0.5}, {"x": 0.9, "y": 0.5}), ViewPipeline(), FakeStream())
    assert not ok and "count mode" in err

    ok, _, err = apply_command({"type": "REBOOT", "config": {}}, pipeline, FakeStream())
    assert not ok and "unknown command" in err


# --- active tracks -------------------------------------------------------------------


def test_active_tracks_in_heartbeat(monkeypatch):
    monkeypatch.setattr(config, "HEARTBEAT_SECONDS", 3600)
    frames = [[person_at(1, 150), person_at(2, 300)], [person_at(2, 310)]]
    pipeline = make_pipeline(frames)
    status = StatusReporter("count", "clip.mp4", base_url="http://127.0.0.1:9")
    stream = FakeLiveStream()
    status.attach_stream(stream)
    status.pipeline_ready(pipeline)

    pipeline.process(FRAME.copy())
    assert pipeline.active_tracks == 2
    stream.frames_ingested += 5
    status.frame_processed(10.0, 80.0, pipeline.active_tracks)
    assert status.payload()["active_tracks"] == 2

    pipeline.process(FRAME.copy())            # person 1 left
    stream.frames_ingested += 5
    status.frame_processed(10.0, 80.0, pipeline.active_tracks)
    assert status.payload()["active_tracks"] == 1

    assert status.payload()["active_tracks"] == 0     # no new frames: stalled, nobody tracked
    assert status.payload(stopping=True)["active_tracks"] == 0
    assert "secret" not in status.payload()["source"] and "admin" not in status.payload()["source"]


# --- VideoPublisher ------------------------------------------------------------------


def test_video_publisher_sends_jpeg_frames(monkeypatch):
    from websockets.sync.server import serve

    received, paths = [], []

    def handler(ws):
        paths.append(ws.request.path)
        for message in ws:
            received.append(message)

    server = serve(handler, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.socket.getsockname()[1]
    monkeypatch.setattr(config, "VIDEO_MAX_FPS", 100)

    video = VideoPublisher(base_url=f"http://127.0.0.1:{port}", camera_id="CAM_T")
    for i in range(30):
        frame = FRAME.copy()
        frame[:, :, 2] = i
        video.publish(frame)
        time.sleep(0.02)
    time.sleep(0.3)
    video.close()
    server.shutdown()

    assert paths == ["/ws/video/ingest/CAM_T"]
    assert received and all(isinstance(m, bytes) and m.startswith(b"\xff\xd8") for m in received)
    assert len(received) <= 30               # never more than offered; stale frames are dropped


def test_video_publisher_scales_down_large_frames(monkeypatch):
    monkeypatch.setattr(config, "VIDEO_MAX_WIDTH", 320)
    video = VideoPublisher.__new__(VideoPublisher)
    import cv2
    data = video._encode(np.zeros((1080, 1920, 3), dtype=np.uint8))
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape[:2] == (180, 320)


# --- CommandListener -----------------------------------------------------------------


class CommandBackend:
    """Hands out one command, records the result."""

    def __init__(self, cmd):
        self.cmd, self.results = cmd, []
        backend = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if backend.cmd is not None:
                    data, backend.cmd = json.dumps(backend.cmd).encode(), None
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    time.sleep(0.2)
                    self.send_response(204)
                    self.end_headers()

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                backend.results.append((self.path, body))
                self.send_response(204)
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


def test_command_listener_round_trip(line_dir):
    cmd = command({"x": 0.5, "y": 0.1}, {"x": 0.5, "y": 0.9})
    backend = CommandBackend(cmd)
    listener = CommandListener(base_url=backend.url, camera_id="CAM_T")
    pipeline, stream = make_pipeline([]), FakeStream()

    taken = None
    for _ in range(100):                      # the frame loop, ~10 ms per frame
        taken = listener.take()
        if taken:
            ok, applied, err = apply_command(taken, pipeline, stream)
            listener.complete(taken, ok, applied, err)
            break
        time.sleep(0.01)
    for _ in range(100):
        if backend.results:
            break
        time.sleep(0.02)
    listener.close()
    backend.server.shutdown()

    assert taken["command_id"] == cmd["command_id"]
    path, result = backend.results[0]
    assert path == f"/api/v1/cameras/CAM_T/commands/{cmd['command_id']}/result"
    assert result["ok"] is True and result["config"]["entry_direction"] == "B_TO_A"


def test_command_listener_reports_busy_when_frame_loop_never_applies(line_dir, monkeypatch):
    monkeypatch.setattr(config, "COMMAND_APPLY_TIMEOUT_SECONDS", 0.3)
    backend = CommandBackend(command({"x": 0.1, "y": 0.5}, {"x": 0.9, "y": 0.5}))
    listener = CommandListener(base_url=backend.url, camera_id="CAM_T")
    for _ in range(100):
        if backend.results:
            break
        time.sleep(0.02)
    listener.close()
    backend.server.shutdown()
    assert backend.results and backend.results[0][1]["ok"] is False
    assert "busy" in backend.results[0][1]["error"]
