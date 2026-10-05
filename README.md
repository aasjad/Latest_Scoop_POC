# Footfall & Incident Management

Three servers that work together:

```
Vision (vision/)            Backend (Backend/)                 Frontend (Frontend/)
YOLO + ByteTrack            FastAPI  :8000                     React + Vite  :5173
counting line  ──HTTP──▶    /api/v1/events     ─▶ latest_scoop.db
saves snapshot              /api/v1/incidents  ─▶ db.py ─▶ DB/incidents.db   ◀──HTTP── dashboard
  incidents/images/*.jpg    /api/v1/incidents/{id}/image (serves the JPEG)
```

- **Vision** detects, tracks and counts people. For every counted line crossing it saves a
  snapshot to `incidents/images/` and POSTs the crossing (as an entry/exit event) and an
  incident to the backend. It never touches SQLite.
- **Backend** owns the databases and is the only thing the browser talks to. Incidents go
  through the root `db.py` into `DB/incidents.db` (one `incidents` table). Images are served
  from disk; only their project-relative path is stored.
- **Frontend** is the dashboard. The **Incidents** page lists, filters, opens, updates and
  deletes incidents and shows their images.

## Install

```bash
pip install -r Backend/requirements.txt
pip install -r vision/requirements.txt
cd Frontend && npm install
```

## Database

Nothing to do by hand: the backend creates `DB/incidents.db` and the `incidents` table on
startup (`python db.py` from the project root does the same on its own).

| Data | Location |
|---|---|
| Incidents (SQLite) | `DB/incidents.db` — override with `INCIDENTS_DB_PATH` |
| Incident images | `incidents/images/` — override with `INCIDENT_IMAGES_DIR` (set it for **both** backend and vision) |
| Entry/exit events (SQLite) | `Backend/latest_scoop.db` — override with `SCOOP_DB_PATH` |

## Start (three terminals, in this order)

```bash
# 1. Backend  -> http://localhost:8000   (API docs: http://localhost:8000/docs)
cd Backend
uvicorn main:app --host 0.0.0.0 --port 8000

# 2. Frontend -> http://localhost:5173   (open this in the browser)
cd Frontend
npm run dev:live          # plain "npm run dev" uses the in-browser mock backend instead

# 3. Vision   (opens an OpenCV window; asks which camera, then the counting line)
cd vision
python main.py
```

Useful vision options: `--source sample.mp4` (a recording instead of a camera),
`--camera-id CAM_02` (default `CAM_01`), `--backend-url http://host:8000`
(default `http://127.0.0.1:8000`), `--no-backend` (count only).
If the backend is down, vision says so and keeps counting.

## Incident API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/incidents` | filters `severity`, `status`, `camera_id`, `event_type`; `limit` (50, max 500), `offset`. Returns `{items, total, limit, offset}`, newest first |
| GET | `/api/v1/incidents/count` | `{total, by_severity, by_status, by_event_type}`; optional `camera_id`, `event_type` |
| GET | `/api/v1/incidents/{id}` | 404 if missing |
| POST | `/api/v1/incidents` | used by vision; 201, 422 invalid data, 400 image outside `incidents/images` |
| PUT | `/api/v1/incidents/{id}` | any of `status`, `severity`, `description`; 400 if empty, 404 if missing |
| DELETE | `/api/v1/incidents/{id}` | 204; also deletes the image file; 404 if missing |
| GET | `/api/v1/incidents/{id}/image` | the JPEG; 404 if no image |

Values: `severity` ∈ `LOW MEDIUM HIGH CRITICAL`, `status` ∈ `OPEN REVIEWED RESOLVED`,
`event_type` is an upper-case identifier (vision sends `LINE_CROSSING`).

An incident:

```json
{
  "id": 5, "camera_id": "CAM_01", "person_id": 2,
  "event_type": "LINE_CROSSING", "severity": "LOW",
  "description": "Person #2 crossed the counting line (ENTRY)",
  "timestamp": "2026-10-05T05:59:52Z",
  "image_path": "incidents/images/incident_CAM_01_20261005T055952_2_4130f3.jpg",
  "image_url": "/api/v1/incidents/5/image",
  "status": "OPEN", "created_at": "2026-10-05T05:59:53Z"
}
```

The other endpoints (events, counts, health, video, WebSocket) are listed in
[Backend/README.md](Backend/README.md).

## Example workflow

1. Start the backend, the frontend and vision as above; draw the counting line in the vision window.
2. Someone walks across the line → vision prints `Backend: incident #12 stored - person #4 ENTRY`.
3. Open http://localhost:5173/incidents → the incident is at the top with its snapshot.
4. Click it → the details drawer shows the full image; set status to *Resolved*, *Save changes*.
5. Filter by status/severity/camera/type, refresh the page — everything comes back from SQLite.
6. *Delete* → *Confirm delete* removes the row and its image.

## Tests

```bash
cd Backend && python -m pytest -q     # API, incl. incidents (uses temp DB/images)
cd vision  && python -m pytest tests -q
cd Frontend && npm run typecheck
```
