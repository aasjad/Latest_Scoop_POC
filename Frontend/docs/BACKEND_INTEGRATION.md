# Backend Integration Guide

What the FastAPI backend must provide for this dashboard. Shapes are defined in code in
`src/types/index.ts`; paths in `src/config/constants.ts` (`ENDPOINTS`) — change paths there only.

**Run against your backend:** set URLs in `.env.live`, then `npm run dev:live`.

## 1. Server requirements

- **CORS** allowed for the dashboard origin (`http://localhost:5173` in dev).
- Timestamps in **UTC ISO 8601 with `Z`**, e.g. `2026-10-05T09:15:30Z`.
- FastAPI query param `from` needs `Query(alias="from")` (it is a Python keyword).
- Errors as standard FastAPI `{"detail": ...}` — the UI shows `detail` in a toast.

## 2. Required (Contract v1.0)

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/v1/events` | `limit, offset, direction, from, to` | `{ items: Event[], total, limit, offset }` |
| GET | `/api/v1/counts` | – | `{ total_entries, total_exits, current_occupancy }` |
| GET | `/api/v1/health` | – | `{ status: "healthy" \| "degraded" \| "unhealthy" }` |
| WS | `/ws/events` | – | messages below |

**Event**

```json
{
  "event_id": "evt_000123",
  "camera_id": "CAM_01",
  "track_id": 42,
  "direction": "ENTRY",
  "timestamp": "2026-10-05T09:15:30Z",
  "confidence": 0.91,
  "snapshot_url": "http://localhost:8000/snapshots/evt_000123.jpg"
}
```

`direction` is `ENTRY` or `EXIT`. `confidence` and `snapshot_url` are optional.

**WebSocket — new crossing** (send *after* the event is saved to the DB):

```json
{ "type": "PERSON_COUNT_EVENT", "data": { ...Event } }
```

## 3. Optional extensions (UI works without them)

If an endpoint returns 404 the UI falls back gracefully (shown in the last column).

| Feature | Method + Path | Body / Response | Without it |
|---|---|---|---|
| Filter events | `GET /events?camera_id=&track_id=` | – | filters ignored |
| Per-camera counts | `GET /counts?camera_id=` | same as counts | totals for all cameras |
| Camera list | `GET /api/v1/cameras` | `Camera[]` | single camera `CAM_01` |
| Edit camera | `PUT /api/v1/cameras/{id}` | `Camera` | save fails with toast |
| Camera health | `GET /api/v1/cameras/{id}/status` | `CameraStatus` | health card shows loading |
| Line config | `GET/PUT /api/v1/cameras/{id}/config` | `CameraConfig` | default line, save fails |
| Reset counters | `POST /api/v1/counts/reset?camera_id=` | 204 | error toast |
| Recording | `GET /api/v1/cameras/{id}/recording?from=&to=` | `{ kind: "video", url, starts_at }` | timeline only |
| Component health | `components` field on `/health` | `{ ai_engine: "online", camera, tracker, database, websocket }` | derived from `status` |

**Camera** — `stream_url` drives the live video (MJPEG endpoint, or an `.mp4`/`.webm` file):

```json
{ "camera_id": "CAM_01", "name": "Main Entrance", "location": "Ground floor", "source": "rtsp://...", "resolution": "1920 × 1080", "stream_url": "http://localhost:8000/stream/CAM_01.mjpg" }
```

**CameraConfig** — all coordinates are **normalised 0–1** relative to the video frame:

```json
{
  "camera_id": "CAM_01",
  "line": { "p1": { "x": 0.06, "y": 0.64 }, "p2": { "x": 0.94, "y": 0.64 } },
  "entry_direction": "B_TO_A",
  "detection_confidence": 0.5,
  "inference_fps": 15,
  "capacity": null
}
```

Side **A** is the left-hand side of the vector `p1 → p2` (screen coordinates, y pointing down).
`A_TO_B` means crossing from A to B counts as **ENTRY**.

**CameraStatus**

```json
{ "camera_id": "CAM_01", "status": "online", "resolution": "1920 × 1080", "camera_fps": 29.9, "inference_fps": 15.0,
  "latency_ms": 67, "frame_drop_pct": 0.3, "model": "YOLOv8n", "uptime_s": 12345, "updated_at": "2026-10-05T09:15:30Z" }
```

`status` is `online`, `degraded` or `offline`.

## 4. Optional WebSocket messages

```json
{ "type": "TRACKS_UPDATE", "data": { "camera_id": "CAM_01", "frame_ts": "2026-10-05T09:15:30Z",
  "tracks": [ { "track_id": 42, "bbox": [0.41, 0.22, 0.08, 0.35], "confidence": 0.91,
                "status": "entering", "trail": [ { "x": 0.45, "y": 0.60 } ] } ] } }

{ "type": "CAMERA_STATUS", "data": { ...CameraStatus } }
```

- `bbox` = `[x, y, width, height]`, normalised 0–1. `trail` = recent foot points, oldest first.
- Track `status`: `entering`, `exiting`, `entered`, `exited`, `tracking`.
- Send `TRACKS_UPDATE` ~10–15×/s to draw live bounding boxes over the video.

## 5. Integration checklist

1. Start backend on `:8000` with CORS enabled.
2. `npm run dev:live` → top bar should show **Live** (not *Reconnecting…*).
3. Process `public/videos/footfall-sample.mp4` in the backend → events appear on Live and Events pages.
4. Add `/cameras` + `stream_url` → video shows on the Live page.
5. Add `TRACKS_UPDATE` → bounding boxes appear on the video.
