"""Persistence, active tracks, counting-line updates through Vision, live video."""

import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from main import create_app
from tests.test_cameras import heartbeat

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32 + b"\xff\xd9"
NEW_LINE = {"p1": {"x": 0.2, "y": 0.3}, "p2": {"x": 0.8, "y": 0.35}}


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "t.db")


@pytest.fixture
def make_client(db_path):
    def _make(**overrides):
        return TestClient(create_app(Settings(db_path=db_path, **overrides)))
    return _make


@pytest.fixture
def client(make_client):
    with make_client() as c:
        yield c


def config_body(**extra):
    return {"line": NEW_LINE, "entry_direction": "B_TO_A", "detection_confidence": 0.15,
            "inference_fps": 15, "capacity": None, **extra}


# --- active tracks --------------------------------------------------------------


def test_active_tracks_reported_and_zero_when_offline(make_client):
    with make_client(camera_timeout_seconds=0.3) as client:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(active_tracks=3))
        assert client.get("/api/v1/cameras/CAM_01/status").json()["active_tracks"] == 3

        with client.websocket_connect("/ws/events") as ws:
            client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(active_tracks=5))
            msg = ws.receive_json()
        assert msg["type"] == "CAMERA_STATUS" and msg["data"]["active_tracks"] == 5

        time.sleep(0.4)  # heartbeats stop
        status = client.get("/api/v1/cameras/CAM_01/status").json()
        assert status["status"] == "offline" and status["active_tracks"] == 0

        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(active_tracks=4, camera_state="stopped"))
        assert client.get("/api/v1/cameras/CAM_01/status").json()["active_tracks"] == 0


def test_watchdog_broadcasts_offline_when_vision_goes_silent(make_client):
    with make_client(camera_timeout_seconds=0.3) as client:
        with client.websocket_connect("/ws/events") as ws:
            client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(active_tracks=2))
            assert ws.receive_json()["data"]["status"] == "online"
            # No more heartbeats: the watchdog (2 s tick) must announce the change.
            msg = ws.receive_json()
            while msg["type"] == "CAMERA_CONFIG":   # the first heartbeat also announced its line
                msg = ws.receive_json()
        assert msg["type"] == "CAMERA_STATUS"
        assert msg["data"]["status"] == "offline" and msg["data"]["active_tracks"] == 0


# --- persistence ----------------------------------------------------------------


def test_camera_configuration_survives_backend_restart(make_client):
    with make_client() as client:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())

    with make_client() as restarted:   # same database, fresh process state
        cameras = restarted.get("/api/v1/cameras").json()
        assert [c["camera_id"] for c in cameras] == ["CAM_01"]
        assert "admin" not in cameras[0]["source"] and "****" not in cameras[0]["source"]
        status = restarted.get("/api/v1/cameras/CAM_01/status").json()
        assert status["status"] == "offline" and status["active_tracks"] == 0
        config = restarted.get("/api/v1/cameras/CAM_01/config").json()
        assert config["line"] == heartbeat()["config"]["line"]
        assert restarted.get("/api/v1/health").json()["components"]["camera"] == "offline"

        # Vision's next heartbeat brings it back.
        restarted.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
        assert restarted.get("/api/v1/cameras/CAM_01/status").json()["status"] == "online"


def test_no_credentials_in_any_camera_response(client):
    client.put("/api/v1/cameras/CAM_01/heartbeat",
               json=heartbeat(source="rtsp://admin:Admin%400192@172.20.100.138:554/stream1"))
    for path in ["/api/v1/cameras", "/api/v1/cameras/CAM_01/status", "/api/v1/cameras/CAM_01/config"]:
        text = client.get(path).text
        assert "admin" not in text.lower() and "0192" not in text


# --- counting line: dashboard -> backend -> Vision ---------------------------------


class FakeVision:
    """Plays Vision's side of the command channel in a thread."""

    def __init__(self, client, answer="apply"):
        self.client, self.answer, self.received = client, answer, []
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        resp = self.client.get("/api/v1/cameras/CAM_01/commands/next", params={"wait": 5})
        if resp.status_code != 200:
            return
        command = resp.json()
        self.received.append(command)
        if self.answer == "silent":
            return
        if self.answer == "apply":
            result = {"ok": True, "config": command["config"]}
        else:
            result = {"ok": False, "error": "line too short for this frame"}
        self.client.post(f"/api/v1/cameras/CAM_01/commands/{command['command_id']}/result", json=result)


def test_line_update_is_applied_by_vision_and_persisted(make_client):
    with make_client() as client:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
        vision = FakeVision(client)
        resp = client.put("/api/v1/cameras/CAM_01/config", json=config_body(capacity=40))
        vision.thread.join(5)
        assert resp.status_code == 200, resp.text
        assert vision.received[0]["type"] == "SET_LINE"
        assert vision.received[0]["config"]["line"] == NEW_LINE
        assert resp.json()["line"] == NEW_LINE and resp.json()["entry_direction"] == "B_TO_A"
        assert resp.json()["capacity"] == 40

    with make_client() as restarted:
        config = restarted.get("/api/v1/cameras/CAM_01/config").json()
        assert config["line"] == NEW_LINE and config["entry_direction"] == "B_TO_A" and config["capacity"] == 40


def test_line_update_refused_when_vision_offline(make_client):
    with make_client(camera_timeout_seconds=0.2) as client:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
        time.sleep(0.3)
        resp = client.put("/api/v1/cameras/CAM_01/config", json=config_body())
        assert resp.status_code == 409 and "offline" in resp.json()["detail"]
        # Nothing changed.
        assert client.get("/api/v1/cameras/CAM_01/config").json()["line"] == heartbeat()["config"]["line"]


def test_line_update_refused_by_vision_is_not_saved(client):
    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
    vision = FakeVision(client, answer="refuse")
    resp = client.put("/api/v1/cameras/CAM_01/config", json=config_body())
    vision.thread.join(5)
    assert resp.status_code == 409 and "too short" in resp.json()["detail"]
    assert client.get("/api/v1/cameras/CAM_01/config").json()["line"] == heartbeat()["config"]["line"]


def test_line_update_times_out_when_vision_does_not_confirm(client, monkeypatch):
    from app.routers import cameras
    monkeypatch.setattr(cameras, "APPLY_TIMEOUT_SECONDS", 0.5)
    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
    vision = FakeVision(client, answer="silent")
    resp = client.put("/api/v1/cameras/CAM_01/config", json=config_body())
    vision.thread.join(5)
    assert resp.status_code == 504 and "NOT changed" in resp.json()["detail"]
    assert client.get("/api/v1/cameras/CAM_01/config").json()["line"] == heartbeat()["config"]["line"]


def test_line_update_needs_count_mode(client):
    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(mode="track", config=None))
    resp = client.put("/api/v1/cameras/CAM_01/config", json=config_body())
    assert resp.status_code == 409 and "count mode" in resp.json()["detail"]


@pytest.mark.parametrize("bad", [
    {"line": {"p1": {"x": 0.5, "y": 0.5}, "p2": {"x": 0.505, "y": 0.5}}},   # too short
    {"line": {"p1": {"x": -0.1, "y": 0.5}, "p2": {"x": 0.9, "y": 0.5}}},    # outside the frame
    {"line": {"p1": {"x": 0.1, "y": 0.5}, "p2": {"x": 1.5, "y": 0.5}}},
    {"entry_direction": "LEFT"},
    {"detection_confidence": 2},
    {"capacity": 0},
    {"camera_id": "CAM_99"},
])
def test_invalid_config_rejected(client, bad):
    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
    assert client.put("/api/v1/cameras/CAM_01/config", json=config_body(**bad)).status_code == 422


def test_capacity_only_change_does_not_need_vision(make_client):
    with make_client(camera_timeout_seconds=0.2) as client:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
        time.sleep(0.3)  # Vision offline
        same_line = {**config_body(), **heartbeat()["config"], "capacity": 25}
        resp = client.put("/api/v1/cameras/CAM_01/config", json=same_line)
        assert resp.status_code == 200 and resp.json()["capacity"] == 25


def test_config_update_unknown_camera(client):
    assert client.put("/api/v1/cameras/CAM_77/config", json=config_body()).status_code == 404


def test_command_poll_returns_204_when_idle(client):
    resp = client.get("/api/v1/cameras/CAM_01/commands/next", params={"wait": 0.1})
    assert resp.status_code == 204


# --- live video -----------------------------------------------------------------


def test_camera_stream_endpoint(client):
    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
    stream_url = client.get("/api/v1/cameras").json()[0]["stream_url"]
    path = stream_url.replace("http://testserver", "")
    assert client.get(path).status_code == 404          # Vision not sending video yet

    with client.websocket_connect("/ws/video/ingest/CAM_01") as ingest:
        ingest.send_bytes(JPEG)
        for _ in range(50):
            if client.get("/api/v1/video").json()["cameras"]:
                break
            time.sleep(0.02)
        snap = client.get("/api/v1/video/CAM_01/snapshot")
        assert snap.status_code == 200 and snap.content == JPEG
        assert snap.headers["content-type"] == "image/jpeg"
    # Vision disconnected: the stream is gone again, not a broken image.
    for _ in range(50):
        if client.get("/api/v1/video/CAM_01/snapshot").status_code == 404:
            break
        time.sleep(0.02)
    assert client.get("/api/v1/video/CAM_01/snapshot").status_code == 404


def test_config_change_is_pushed_to_dashboards(client):
    # First heartbeat: Vision still loading, no line yet.
    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(config=None))
    with client.websocket_connect("/ws/events") as ws:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())   # now it has one
        messages = [ws.receive_json(), ws.receive_json()]
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())   # unchanged: status only
        assert ws.receive_json()["type"] == "CAMERA_STATUS"
    config = next(m for m in messages if m["type"] == "CAMERA_CONFIG")["data"]
    assert config["camera_id"] == "CAM_01" and config["line"] == heartbeat()["config"]["line"]
