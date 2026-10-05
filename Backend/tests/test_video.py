import asyncio
import threading
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.video import FrameHub
from main import create_app

FRAME_1 = b"\xff\xd8 first frame \xff\xd9"
FRAME_2 = b"\xff\xd8 second frame \xff\xd9"
INGEST = "/ws/video/ingest/CAM_01"


@pytest.fixture
def make_client(tmp_path):
    def _make(**overrides):
        settings = Settings(db_path=str(tmp_path / "test.db"), **overrides)
        return TestClient(create_app(settings))

    return _make


@pytest.fixture
def client(make_client):
    with make_client() as c:
        yield c


def wait_until(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("condition not met in time")


def snapshot_is(client, expected):
    resp = client.get("/api/v1/video/CAM_01/snapshot")
    return resp.status_code == 200 and resp.content == expected


# --- discovery / not streaming --------------------------------------------


def test_no_cameras_initially(client):
    assert client.get("/api/v1/video").json() == {"cameras": []}


@pytest.mark.parametrize("path", ["/api/v1/video/CAM_01", "/api/v1/video/CAM_01/snapshot"])
def test_404_when_camera_not_streaming(client, path):
    resp = client.get(path)
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Camera is not streaming"}


# --- ingest ----------------------------------------------------------------


def test_ingested_frame_available_as_snapshot(client):
    with client.websocket_connect(INGEST) as ws:
        ws.send_bytes(FRAME_1)
        wait_until(lambda: snapshot_is(client, FRAME_1))
        resp = client.get("/api/v1/video/CAM_01/snapshot")
        assert resp.headers["content-type"] == "image/jpeg"

        cameras = client.get("/api/v1/video").json()["cameras"]
        assert [c["camera_id"] for c in cameras] == ["CAM_01"]
        assert cameras[0]["last_frame_at"].endswith("Z")

        ws.send_bytes(FRAME_2)
        wait_until(lambda: snapshot_is(client, FRAME_2))


def test_camera_removed_when_ingest_disconnects(client):
    with client.websocket_connect(INGEST) as ws:
        ws.send_bytes(FRAME_1)
        wait_until(lambda: snapshot_is(client, FRAME_1))
    wait_until(lambda: client.get("/api/v1/video").json() == {"cameras": []})
    assert client.get("/api/v1/video/CAM_01/snapshot").status_code == 404


@pytest.mark.parametrize(
    "send, code",
    [
        (lambda ws: ws.send_bytes(b"not a jpeg"), 1003),
        (lambda ws: ws.send_text("hello"), 1003),
    ],
)
def test_ingest_rejects_invalid_frames(client, send, code):
    with client.websocket_connect(INGEST) as ws:
        send(ws)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_bytes()
        assert exc.value.code == code


def test_ingest_rejects_oversized_frames(make_client):
    with make_client(max_frame_bytes=10) as c, c.websocket_connect(INGEST) as ws:
        ws.send_bytes(FRAME_1)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_bytes()
        assert exc.value.code == 1009


def test_ingest_api_key_enforced_when_configured(make_client):
    with make_client(ingest_api_key="secret") as c:
        with pytest.raises(WebSocketDisconnect) as exc:
            with c.websocket_connect(INGEST):
                pass
        assert exc.value.code == 1008

        with c.websocket_connect(INGEST, headers={"X-API-Key": "secret"}) as ws:
            ws.send_bytes(FRAME_1)
            wait_until(lambda: snapshot_is(c, FRAME_1))


# --- MJPEG stream ----------------------------------------------------------


def test_mjpeg_stream_relays_frames_until_camera_stops(client):
    # TestClient buffers the whole body, so read the stream in a thread and end it
    # by disconnecting the camera.
    result = {}

    with client.websocket_connect(INGEST) as ws:
        ws.send_bytes(FRAME_1)
        wait_until(lambda: snapshot_is(client, FRAME_1))

        reader = threading.Thread(
            target=lambda: result.setdefault("resp", client.get("/api/v1/video/CAM_01"))
        )
        reader.start()
        time.sleep(0.3)
        ws.send_bytes(FRAME_2)
        time.sleep(0.3)

    reader.join(timeout=5)
    assert not reader.is_alive(), "stream did not end after camera disconnected"

    resp = result["resp"]
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "multipart/x-mixed-replace; boundary=frame"
    body = resp.content
    assert body.startswith(b"--frame\r\nContent-Type: image/jpeg\r\n")
    assert f"Content-Length: {len(FRAME_1)}".encode() in body
    assert body.index(FRAME_1) < body.index(FRAME_2)


# --- FrameHub --------------------------------------------------------------


def test_stale_connection_cannot_close_newer_feed():
    async def scenario():
        hub = FrameHub()
        old, new = object(), object()
        await hub.attach("CAM_01", owner=old)
        feed = await hub.attach("CAM_01", owner=new)  # camera reconnected
        await hub.detach("CAM_01", owner=old)  # old socket finally times out
        assert hub.get("CAM_01") is feed and not feed.closed
        await hub.detach("CAM_01", owner=new)
        assert hub.get("CAM_01") is None and feed.closed

    asyncio.run(scenario())
