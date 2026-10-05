# Latest Scoop — Backend

FastAPI + SQLite backend implementing API Contract v1.0, plus the v1.1 additions in
[`../API_CONTRACT_v1.1_CHANGES.md`](../API_CONTRACT_v1.1_CHANGES.md) (daily counts, live video).

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Interactive docs: http://localhost:8000/docs

Run with a **single worker**: WebSocket clients and live video frames are kept in memory.

## Configuration (environment variables)

| Variable                | Default                                        | Purpose                                                            |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `SCOOP_DB_PATH`         | `latest_scoop.db`                              | SQLite file (created on startup)                                   |
| `SCOOP_CORS_ORIGINS`    | `http://localhost:5173,http://127.0.0.1:5173`  | Comma-separated origins allowed for the React app                  |
| `INCIDENTS_DB_PATH`     | `../DB/incidents.db`                           | Incidents SQLite file, managed by the project's `db.py`            |
| `INCIDENT_IMAGES_DIR`   | `../incidents/images`                          | Incident snapshots; only files inside it are served                |
| `SCOOP_INGEST_API_KEY`  | *(empty — disabled)*                           | If set, `POST /api/v1/events` and video ingest require `X-API-Key` |
| `SCOOP_MAX_FRAME_BYTES` | `2097152` (2 MB)                               | Largest JPEG frame accepted on video ingest                        |

## Endpoints

| Method | Path                                 | Notes                                                        |
| ------ | ------------------------------------ | ------------------------------------------------------------ |
| POST   | `/api/v1/events`                     | 201 stored · 409 duplicate · 422 invalid · 500 DB failure    |
| GET    | `/api/v1/events`                     | `limit` (default 50, max 500), `offset`, `direction`, `from`, `to` |
| GET    | `/api/v1/counts`                     | Optional `from`, `to`. `current_occupancy = total_entries - total_exits` within the window |
| GET    | `/api/v1/health`                     | 200 healthy · 503 if the database is unreachable             |
| WS     | `/ws/events`                         | Pushes `PERSON_COUNT_EVENT` after each successful insert     |
| WS     | `/ws/video/ingest/{camera_id}`       | AI Engine sends one binary JPEG per message                  |
| GET    | `/api/v1/video`                      | Cameras currently streaming                                  |
| GET    | `/api/v1/video/{camera_id}`          | MJPEG stream for `<img src>` · 404 if not streaming          |
| GET    | `/api/v1/video/{camera_id}/snapshot` | Latest frame as JPEG · 404 if not streaming                  |
| GET    | `/api/v1/incidents`                  | Filters `severity`, `status`, `camera_id`, `event_type`; `limit`, `offset` |
| GET    | `/api/v1/incidents/count`            | Totals by severity, status and event type                    |
| GET    | `/api/v1/incidents/{id}`             | 404 if missing                                               |
| POST   | `/api/v1/incidents`                  | From the Vision server · 201 · 422 invalid · 400 bad `image_path` |
| PUT    | `/api/v1/incidents/{id}`             | `status` / `severity` / `description` · 400 empty · 404       |
| DELETE | `/api/v1/incidents/{id}`             | 204, also removes the image · 404                            |
| GET    | `/api/v1/incidents/{id}/image`       | Snapshot JPEG · 404 if none                                  |

Incidents are stored by the root [`db.py`](../db.py) in `DB/incidents.db`; see the
[project README](../README.md) for the full Vision → Backend → Frontend flow.

## Decisions where the contract is silent

- **Timestamps** must include a timezone (`Z` or `+05:30`); naive timestamps get 422.
  They are converted to UTC and stored as `YYYY-MM-DDTHH:MM:SSZ` (sub-seconds dropped)
  so that text ordering equals time ordering.
- **`from` is inclusive, `to` is exclusive.** `from >= to` gets 422.
  The same rules apply to `/events` and `/counts`.
- **Daily counts** (extension to v1.0): `/counts` without `from`/`to` is all-time, as in the
  contract. For one day, pass the store's local midnights with their offset, e.g.
  `GET /api/v1/counts?from=2026-10-01T00:00:00+05:30&to=2026-10-02T00:00:00+05:30`.
  Occupancy for the window assumes the store was empty at `from`.
- **Ordering:** newest first; events in the same second fall back to insertion order.
- **Broadcast** happens only after the insert commits, and runs after the HTTP response
  is sent, so slow dashboard clients never delay the AI Engine.
- **WebSocket keep-alive:** client may send `ping`, server replies `pong`.
- **AI Engine retries:** a `409` on retry means the event is already stored, so treat it as success.
- **Live video** is relayed, not recorded: only the latest frame per camera is held in memory.
  A camera disappears from `/api/v1/video` when its ingest connection closes, and open
  streams for it end. A new ingest connection for the same `camera_id` takes over.

## Tests

```bash
python -m pytest -q
```
