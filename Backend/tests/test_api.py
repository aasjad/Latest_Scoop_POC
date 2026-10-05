import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from main import create_app


def make_event(event_id="evt_001", direction="ENTRY", timestamp="2026-10-01T10:30:00Z", **extra):
    return {
        "event_id": event_id,
        "camera_id": "CAM_01",
        "track_id": 12,
        "direction": direction,
        "timestamp": timestamp,
        **extra,
    }


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


# --- POST /api/v1/events ---------------------------------------------------


def test_create_event_returns_201(client):
    resp = client.post("/api/v1/events", json=make_event())
    assert resp.status_code == 201
    assert resp.json() == {
        "success": True,
        "message": "Event stored successfully",
        "event_id": "evt_001",
    }


def test_duplicate_event_returns_409(client):
    client.post("/api/v1/events", json=make_event())
    resp = client.post("/api/v1/events", json=make_event())
    assert resp.status_code == 409
    assert resp.json() == {"detail": "Event already exists"}


@pytest.mark.parametrize(
    "payload",
    [
        make_event(direction="entry"),
        make_event(direction="IN"),
        make_event(timestamp="not-a-date"),
        make_event(timestamp="2026-10-01T10:30:00"),  # no timezone
        make_event(track_id="12"),
        make_event(track_id=-1),
        make_event(event_id=""),
        {k: v for k, v in make_event().items() if k != "camera_id"},
    ],
)
def test_invalid_payload_returns_422(client, payload):
    assert client.post("/api/v1/events", json=payload).status_code == 422


def test_timestamp_normalized_to_utc(client):
    client.post("/api/v1/events", json=make_event(timestamp="2026-10-01T16:00:00.123+05:30"))
    item = client.get("/api/v1/events").json()["items"][0]
    assert item["timestamp"] == "2026-10-01T10:30:00Z"


def test_ingest_api_key_enforced_when_configured(make_client):
    with make_client(ingest_api_key="secret") as c:
        assert c.post("/api/v1/events", json=make_event()).status_code == 401
        resp = c.post("/api/v1/events", json=make_event(), headers={"X-API-Key": "secret"})
        assert resp.status_code == 201


# --- GET /api/v1/events ----------------------------------------------------


def seed(client):
    events = [
        make_event("evt_1", "ENTRY", "2026-10-01T09:00:00Z"),
        make_event("evt_2", "ENTRY", "2026-10-01T10:00:00Z"),
        make_event("evt_3", "EXIT", "2026-10-01T11:00:00Z"),
        make_event("evt_4", "ENTRY", "2026-10-01T12:00:00Z"),
    ]
    for e in events:
        assert client.post("/api/v1/events", json=e).status_code == 201


def test_list_events_newest_first(client):
    seed(client)
    body = client.get("/api/v1/events").json()
    assert [e["event_id"] for e in body["items"]] == ["evt_4", "evt_3", "evt_2", "evt_1"]
    assert body["total"] == 4
    assert body["offset"] == 0


def test_list_events_pagination(client):
    seed(client)
    body = client.get("/api/v1/events?limit=2&offset=1").json()
    assert [e["event_id"] for e in body["items"]] == ["evt_3", "evt_2"]
    assert body == {**body, "total": 4, "limit": 2, "offset": 1}


def test_list_events_direction_filter(client):
    seed(client)
    body = client.get("/api/v1/events?direction=ENTRY").json()
    assert {e["direction"] for e in body["items"]} == {"ENTRY"}
    assert body["total"] == 3


def test_list_events_time_range(client):
    seed(client)
    body = client.get(
        "/api/v1/events", params={"from": "2026-10-01T10:00:00Z", "to": "2026-10-01T12:00:00Z"}
    ).json()
    assert [e["event_id"] for e in body["items"]] == ["evt_3", "evt_2"]


@pytest.mark.parametrize(
    "query",
    [
        "direction=SIDEWAYS",
        "limit=0",
        "limit=100000",
        "offset=-1",
        "from=yesterday",
        "from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z",
    ],
)
def test_list_events_invalid_query_returns_422(client, query):
    assert client.get(f"/api/v1/events?{query}").status_code == 422


# --- GET /api/v1/counts ----------------------------------------------------


def test_counts_empty(client):
    assert client.get("/api/v1/counts").json() == {
        "total_entries": 0,
        "total_exits": 0,
        "current_occupancy": 0,
    }


def test_counts(client):
    seed(client)
    assert client.get("/api/v1/counts").json() == {
        "total_entries": 3,
        "total_exits": 1,
        "current_occupancy": 2,
    }


def test_counts_daily_window(client):
    seed(client)  # all on 2026-10-01 between 09:00 and 12:00 UTC
    client.post("/api/v1/events", json=make_event("evt_prev", "ENTRY", "2026-09-30T23:59:59Z"))
    client.post("/api/v1/events", json=make_event("evt_next", "EXIT", "2026-10-02T00:00:00Z"))

    day = {"from": "2026-10-01T00:00:00Z", "to": "2026-10-02T00:00:00Z"}
    assert client.get("/api/v1/counts", params=day).json() == {
        "total_entries": 3,
        "total_exits": 1,
        "current_occupancy": 2,
    }
    # Without a window, counts stay all-time.
    assert client.get("/api/v1/counts").json()["total_entries"] == 4


def test_counts_window_respects_timezone_offset(client):
    seed(client)
    # IST day 2026-10-01 starting 15:30 IST = 10:00 UTC: includes evt_2, evt_3, evt_4.
    window = {"from": "2026-10-01T15:30:00+05:30", "to": "2026-10-02T00:00:00+05:30"}
    assert client.get("/api/v1/counts", params=window).json() == {
        "total_entries": 2,
        "total_exits": 1,
        "current_occupancy": 1,
    }


def test_counts_only_from(client):
    seed(client)
    body = client.get("/api/v1/counts", params={"from": "2026-10-01T11:00:00Z"}).json()
    assert body == {"total_entries": 1, "total_exits": 1, "current_occupancy": 0}


@pytest.mark.parametrize(
    "query",
    ["from=yesterday", "from=2026-10-01T00:00:00", "from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z"],
)
def test_counts_invalid_window_returns_422(client, query):
    assert client.get(f"/api/v1/counts?{query}").status_code == 422


# --- GET /api/v1/health ----------------------------------------------------


def test_health(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    # No Vision heartbeat yet: the backend is healthy, the Vision components are offline.
    assert resp.json() == {
        "status": "healthy",
        "components": {"database": "online", "ai_engine": "offline", "camera": "offline", "tracker": "offline"},
    }


# --- WebSocket /ws/events --------------------------------------------------


def test_websocket_receives_stored_event(client):
    with client.websocket_connect("/ws/events") as ws:
        client.post("/api/v1/events", json=make_event())
        assert ws.receive_json() == {
            "type": "PERSON_COUNT_EVENT",
            "data": make_event(),
        }


def test_websocket_not_notified_for_rejected_event(client):
    client.post("/api/v1/events", json=make_event("evt_first"))
    with client.websocket_connect("/ws/events") as ws:
        assert client.post("/api/v1/events", json=make_event("evt_first")).status_code == 409
        client.post("/api/v1/events", json=make_event("evt_second"))
        # The first message must be the second event: the duplicate was never broadcast.
        assert ws.receive_json()["data"]["event_id"] == "evt_second"


def test_websocket_ping(client):
    with client.websocket_connect("/ws/events") as ws:
        ws.send_text("ping")
        assert ws.receive_text() == "pong"
