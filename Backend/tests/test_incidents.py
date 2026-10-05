import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from main import create_app

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"


def make_incident(**extra):
    return {
        "camera_id": "CAM_01",
        "person_id": 17,
        "event_type": "LINE_CROSSING",
        "severity": "LOW",
        "description": "Person #17 crossed the counting line (ENTRY)",
        "timestamp": "2026-10-05T10:15:00+05:30",
        **extra,
    }


@pytest.fixture
def images_dir(tmp_path):
    path = tmp_path / "images"
    path.mkdir()
    return path


@pytest.fixture
def client(tmp_path, images_dir):
    settings = Settings(
        db_path=str(tmp_path / "events.db"),
        incidents_db_path=str(tmp_path / "incidents.db"),
        incident_images_dir=str(images_dir),
    )
    with TestClient(create_app(settings)) as c:
        yield c


def create(client, **extra):
    resp = client.post("/api/v1/incidents", json=make_incident(**extra))
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_returns_stored_incident(client):
    body = create(client)
    assert body["id"] >= 1
    assert body["status"] == "OPEN"
    assert body["timestamp"] == "2026-10-05T04:45:00Z"  # normalized to UTC
    assert body["created_at"].endswith("Z")
    assert body["image_path"] is None and body["image_url"] is None


@pytest.mark.parametrize(
    "bad",
    [
        {"severity": "URGENT"},
        {"event_type": "line crossing"},
        {"timestamp": "2026-10-05T10:15:00"},  # no timezone
        {"camera_id": ""},
        {"person_id": -1},
    ],
)
def test_create_rejects_invalid_data(client, bad):
    assert client.post("/api/v1/incidents", json=make_incident(**bad)).status_code == 422


def test_create_rejects_image_outside_images_dir(client, tmp_path):
    resp = client.post("/api/v1/incidents", json=make_incident(image_path=str(tmp_path / "secret.jpg")))
    assert resp.status_code == 400
    resp = client.post("/api/v1/incidents", json=make_incident(image_path="../../../etc/passwd"))
    assert resp.status_code == 400


def test_get_one_and_404(client):
    created = create(client)
    assert client.get(f"/api/v1/incidents/{created['id']}").json() == created
    assert client.get("/api/v1/incidents/9999").status_code == 404


def test_list_newest_first_with_filters_and_paging(client):
    create(client, severity="LOW", timestamp="2026-10-05T10:00:00Z")
    create(client, severity="CRITICAL", camera_id="CAM_02", event_type="ZONE_INTRUSION", timestamp="2026-10-05T11:00:00Z")
    create(client, severity="CRITICAL", timestamp="2026-10-05T12:00:00Z")

    page = client.get("/api/v1/incidents").json()
    assert page["total"] == 3
    assert [i["timestamp"][11:13] for i in page["items"]] == ["12", "11", "10"]

    assert client.get("/api/v1/incidents?severity=CRITICAL").json()["total"] == 2
    assert client.get("/api/v1/incidents?camera_id=CAM_02").json()["total"] == 1
    assert client.get("/api/v1/incidents?event_type=ZONE_INTRUSION").json()["total"] == 1
    assert client.get("/api/v1/incidents?status=OPEN").json()["total"] == 3
    assert client.get("/api/v1/incidents?status=RESOLVED").json()["total"] == 0

    paged = client.get("/api/v1/incidents?limit=1&offset=1").json()
    assert paged["total"] == 3 and len(paged["items"]) == 1
    assert client.get("/api/v1/incidents?status=bogus").status_code == 422


def test_count(client):
    create(client, severity="LOW")
    second = create(client, severity="CRITICAL")
    client.put(f"/api/v1/incidents/{second['id']}", json={"status": "RESOLVED"})
    assert client.get("/api/v1/incidents/count").json() == {
        "total": 2,
        "by_severity": {"LOW": 1, "CRITICAL": 1},
        "by_status": {"OPEN": 1, "RESOLVED": 1},
        "by_event_type": {"LINE_CROSSING": 2},
    }


def test_update(client):
    created = create(client)
    resp = client.put(f"/api/v1/incidents/{created['id']}", json={"status": "REVIEWED", "description": "checked"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "REVIEWED"
    assert resp.json()["description"] == "checked"
    assert resp.json()["severity"] == "LOW"  # untouched

    assert client.put(f"/api/v1/incidents/{created['id']}", json={}).status_code == 400
    assert client.put(f"/api/v1/incidents/{created['id']}", json={"status": "DONE"}).status_code == 422
    assert client.put("/api/v1/incidents/9999", json={"status": "RESOLVED"}).status_code == 404


def test_delete_removes_row_and_image(client, images_dir):
    image = images_dir / "incident_a.jpg"
    image.write_bytes(JPEG)
    created = create(client, image_path=str(image))

    assert client.delete(f"/api/v1/incidents/{created['id']}").status_code == 204
    assert client.get(f"/api/v1/incidents/{created['id']}").status_code == 404
    assert not image.exists()
    assert client.delete(f"/api/v1/incidents/{created['id']}").status_code == 404


def test_image_is_served(client, images_dir):
    image = images_dir / "incident_b.jpg"
    image.write_bytes(JPEG)
    created = create(client, image_path=str(image))
    assert created["image_url"] == f"/api/v1/incidents/{created['id']}/image"

    resp = client.get(created["image_url"])
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.content == JPEG


def test_image_404_when_missing(client, images_dir):
    no_image = create(client)
    assert client.get(f"/api/v1/incidents/{no_image['id']}/image").status_code == 404

    gone = create(client, image_path=str(images_dir / "never_written.jpg"))
    assert client.get(f"/api/v1/incidents/{gone['id']}/image").status_code == 404
    assert client.get("/api/v1/incidents/9999/image").status_code == 404


def test_cors_allows_frontend_for_put_and_delete(client):
    resp = client.options(
        "/api/v1/incidents/1",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE"},
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"

    resp = client.options(
        "/api/v1/incidents/1",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "DELETE"},
    )
    assert "access-control-allow-origin" not in resp.headers
