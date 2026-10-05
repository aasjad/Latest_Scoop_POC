import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from main import create_app


def heartbeat(**extra):
    return {
        "name": "172.20.100.138",
        "source": "rtsp://admin:****@172.20.100.138:554/cam/realmonitor?channel=1&subtype=1",
        "resolution": "640 × 480",
        "mode": "count",
        "model": "yolov8n.pt",
        "tracker_active": True,
        "camera_state": "streaming",
        "camera_fps": 24.8,
        "inference_fps": 11.3,
        "latency_ms": 95,
        "frame_drop_pct": 54.2,
        "uptime_s": 42,
        "config": {
            "line": {"p1": {"x": 0.1, "y": 0.5}, "p2": {"x": 0.9, "y": 0.5}},
            "entry_direction": "A_TO_B",
            "detection_confidence": 0.15,
        },
        **extra,
    }


@pytest.fixture
def make_client(tmp_path):
    def _make(**overrides):
        return TestClient(create_app(Settings(db_path=str(tmp_path / "t.db"), **overrides)))

    return _make


@pytest.fixture
def client(make_client):
    with make_client() as c:
        yield c


def test_no_heartbeat_means_no_cameras(client):
    assert client.get("/api/v1/cameras").json() == []
    assert client.get("/api/v1/cameras/CAM_01/status").status_code == 404
    assert client.get("/api/v1/cameras/CAM_01/config").status_code == 404


def test_heartbeat_registers_camera_with_status_and_config(client):
    assert client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat()).status_code == 204

    cameras = client.get("/api/v1/cameras").json()
    assert cameras == [{
        "camera_id": "CAM_01", "name": "172.20.100.138", "location": "—",
        # Credentials are stripped, user name included.
        "source": "rtsp://172.20.100.138:554/cam/realmonitor?channel=1&subtype=1",
        "resolution": "640 × 480",
        # Always the camera's MJPEG endpoint; it answers 404 while Vision sends no video.
        "stream_url": "http://testserver/api/v1/video/CAM_01",
    }]

    status = client.get("/api/v1/cameras/CAM_01/status").json()
    assert status["status"] == "online"
    assert status["camera_fps"] == 24.8 and status["inference_fps"] == 11.3
    assert status["model"] == "yolov8n.pt" and status["uptime_s"] == 42
    assert status["updated_at"].endswith("Z")

    config = client.get("/api/v1/cameras/CAM_01/config").json()
    assert config == {
        "camera_id": "CAM_01",
        "line": {"p1": {"x": 0.1, "y": 0.5}, "p2": {"x": 0.9, "y": 0.5}},
        "entry_direction": "A_TO_B",
        "detection_confidence": 0.15,
        "inference_fps": 11,
        "capacity": None,
    }

    assert client.get("/api/v1/health").json()["components"] == {
        "database": "online", "ai_engine": "online", "camera": "online", "tracker": "online",
    }


def test_states_follow_what_vision_reports(client):
    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(camera_state="stalled"))
    assert client.get("/api/v1/cameras/CAM_01/status").json()["status"] == "degraded"
    assert client.get("/api/v1/health").json()["components"]["camera"] == "degraded"

    # View mode: Vision runs but loads no model and no tracker, and has no line.
    client.put("/api/v1/cameras/CAM_01/heartbeat",
               json=heartbeat(mode="view", model=None, tracker_active=False, config=None))
    components = client.get("/api/v1/health").json()["components"]
    assert components["ai_engine"] == "degraded" and components["tracker"] == "offline"
    # The last line Vision used is kept (it is still saved in Vision's line file).
    assert client.get("/api/v1/cameras/CAM_01/config").json()["line"] == heartbeat()["config"]["line"]

    client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(camera_state="stopped"))
    assert client.get("/api/v1/cameras/CAM_01/status").json()["status"] == "offline"
    assert client.get("/api/v1/health").json()["components"]["ai_engine"] == "offline"


def test_camera_goes_offline_when_heartbeats_stop(make_client):
    with make_client(camera_timeout_seconds=0.2) as client:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
        assert client.get("/api/v1/cameras/CAM_01/status").json()["status"] == "online"
        time.sleep(0.3)
        assert client.get("/api/v1/cameras/CAM_01/status").json()["status"] == "offline"
        assert client.get("/api/v1/health").json()["components"]["camera"] == "offline"
        # Still listed, so the dashboard can say "Camera Offline" rather than "No camera".
        assert [c["camera_id"] for c in client.get("/api/v1/cameras").json()] == ["CAM_01"]


def test_heartbeat_is_broadcast_as_camera_status(client):
    with client.websocket_connect("/ws/events") as ws:
        client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat())
        message = ws.receive_json()
    assert message["type"] == "CAMERA_STATUS"
    assert message["data"]["camera_id"] == "CAM_01" and message["data"]["status"] == "online"


def test_invalid_heartbeat_rejected(client):
    assert client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(mode="bogus")).status_code == 422
    assert client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(frame_drop_pct=120)).status_code == 422


def test_heartbeat_requires_key_when_configured(make_client):
    with make_client(ingest_api_key="secret") as client:
        assert client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat()).status_code == 401
        resp = client.put("/api/v1/cameras/CAM_01/heartbeat", json=heartbeat(), headers={"X-API-Key": "secret"})
        assert resp.status_code == 204


# --- events / counts filters used by the dashboard ----------------------------


def event(event_id, camera_id, track_id, direction, ts):
    return {"event_id": event_id, "camera_id": camera_id, "track_id": track_id, "direction": direction, "timestamp": ts}


def test_chart_request_with_large_limit_and_camera_filter(client):
    client.post("/api/v1/events", json=event("a", "CAM_01", 1, "ENTRY", "2026-10-05T08:00:00Z"))
    client.post("/api/v1/events", json=event("b", "CAM_02", 2, "ENTRY", "2026-10-05T08:05:00Z"))
    client.post("/api/v1/events", json=event("c", "CAM_01", 3, "EXIT", "2026-10-05T09:00:00Z"))

    # Exactly the shape useFootfallSeries sends.
    resp = client.get(
        "/api/v1/events",
        params={"camera_id": "CAM_01", "from": "2026-10-04T18:30:00.000Z", "to": "2026-10-05T18:29:59.999Z", "limit": 50000},
    )
    assert resp.status_code == 200, resp.text
    assert [e["event_id"] for e in resp.json()["items"]] == ["c", "a"]

    assert client.get("/api/v1/events", params={"track_id": 2}).json()["total"] == 1
    assert client.get("/api/v1/events", params={"limit": 50001}).status_code == 422

    assert client.get("/api/v1/counts", params={"camera_id": "CAM_01"}).json() == {
        "total_entries": 1, "total_exits": 1, "current_occupancy": 0,
    }
    assert client.get("/api/v1/counts", params={"camera_id": "CAM_02"}).json()["total_entries"] == 1
    assert client.get("/api/v1/counts").json()["total_entries"] == 2
