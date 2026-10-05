import pytest


@pytest.fixture(autouse=True)
def isolated_incident_storage(tmp_path, monkeypatch):
    """Keep every test away from the real DB/incidents.db and incidents/images.

    Settings reads these at construction, so tests that build Settings() with
    only db_path still get temporary incident storage.
    """
    monkeypatch.setenv("INCIDENTS_DB_PATH", str(tmp_path / "incidents_default.db"))
    monkeypatch.setenv("INCIDENT_IMAGES_DIR", str(tmp_path / "incident_images_default"))
