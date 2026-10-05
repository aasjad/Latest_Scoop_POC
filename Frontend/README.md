# Footfall AI — Frontend

React + TypeScript + Vite + Tailwind dashboard for the Latest Scoop people-counting system.
It runs on its own with an in-browser **mock backend**, and switches to the real **FastAPI backend** with one env flag.

## Quick start

```bash
npm install
npm run dev        # mock backend → http://localhost:5173
npm run dev:live   # real backend (URLs from .env.live)
npm run build:live # production build for the real backend (mock code removed)
```

| Variable | Mock (`.env`) | Live (`.env.live`) |
|---|---|---|
| `VITE_USE_MOCK` | `true` | `false` |
| `VITE_API_BASE_URL` | – | `http://localhost:8000` |
| `VITE_WS_URL` | – | `ws://localhost:8000/ws/events` |

## Pages

| Page | What it shows |
|---|---|
| **Live** | Camera video, bounding boxes, counting line editor, In / Out / Inside KPIs, live events |
| **Playback** | Recorded video with event markers on a timeline |
| **Events** | Searchable, paginated event log with snapshots |
| **Analytics** | Footfall charts (live, today, 7 days, custom) |
| **Cameras / Settings** | Camera list, detection settings, counter reset, demo tools (mock only) |

## Folder map

```
src/
  api/         ← the ONLY place that talks to the backend (http.ts, socket.ts); index.ts picks mock or real
  config/      ← constants.ts: every endpoint path (ENDPOINTS), defaults, thresholds
  types/       ← index.ts: all request/response shapes (= the API contract in code)
  store/       ← zustand state: cameras, counts, events, line config, connection, UI
  hooks/       ← data wiring (useLiveFeed = REST + WebSocket → stores)
  components/  ← UI pieces (live, kpi, charts, events, health, playback, layout, common)
  pages/       ← one file per route
  mocks/       ← fake backend for development only — not included in live builds
public/videos/ ← real sample footage for testing (see below)
```

## Sample footage

`public/videos/footfall-sample.mp4` — real CC BY 4.0 footage of people walking ([attribution](public/videos/ATTRIBUTION.md)).

- In mock mode it appears as camera **CAM_04 · Sample Footage** (video only, counts come from the backend).
- Any camera whose `stream_url` ends in `.mp4` / `.webm` plays as a looping video; other URLs are treated as MJPEG.
- Backend team: use the same file as the video source to test real counting end-to-end.

## Backend integration

See **[docs/BACKEND_INTEGRATION.md](docs/BACKEND_INTEGRATION.md)** for every endpoint, payload and WebSocket message the UI expects.

## Known limitations

- Charts aggregate raw events in the browser (capped at 50,000 events per range).
- No login yet — `src/config/user.ts` is a placeholder admin user.
