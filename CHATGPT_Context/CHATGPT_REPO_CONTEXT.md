# CHATGPT Repo Context: WaterStatus

## Project Name and Purpose
- Project: **River & Farm Guardian / Water Status**
- Purpose: Flood/water monitoring and community reporting app with:
  - Backend API for sensor data, weather context, users, and user reports
  - Frontend React Router app for dashboards, maps, posts, users, and product/cart UI
  - Deployment setup for Render and Raspberry Pi operations

## High-Level Architecture
- Monorepo-style layout with separate `backend` and `frontend` apps.
- Backend:
  - FastAPI (`backend/app/main.py`)
  - Data layer supports Postgres (`DATABASE_URL`) via `asyncpg`, with SQLite fallback (`backend/app/db.py`)
  - Sensor ingest pipeline (official Selangor endpoints + generated fallback readings)
  - Weather context via Open-Meteo integration (`backend/app/weather_context.py`)
- Frontend:
  - React Router v7 + Vite + TypeScript (`frontend`)
  - Calls backend through centralized base URL detection (`frontend/app/lib/api.ts`)
  - Multi-route UI (`home`, `sensors`, `posts`, `users`, `products`, `cart`, etc.)
- Deploy/Ops:
  - Render services defined in `render.yaml` (Python web service + static frontend)
  - Raspberry Pi systemd unit files and quick tunnel scripts in `backend/ops/`

## Current Repo / Folder Map
- `backend/`
- `frontend/`
- `.github/workflows/ping-health.yml`
- `render.yaml`
- `README.md`
- `notes.txt`
- `.raspi-recovery.md` (local recovery notes, not for remote sharing)
- `requirements.txt` (points to backend requirements)
- `package.json` (minimal root dependency entry)
- `CHATGPT_Context/` (this folder)

## Important Files and What They Do
- Root
  - `README.md`: top-level quick commands and project identity
  - `render.yaml`: Render deployment config (backend + frontend static site)
  - `.github/workflows/ping-health.yml`: scheduled health ping to keep backend awake
  - `notes.txt`: local dev/ops command notes
  - `.raspi-recovery.md`: Raspberry Pi recovery playbook
- Backend
  - `backend/app/main.py`: primary FastAPI app, route handlers, auth/session logic, ingest scheduling, rate limiting, home preview logic
  - `backend/app/db.py`: DB abstraction layer (Postgres primary, SQLite fallback)
  - `backend/app/weather_context.py`: Open-Meteo fetch/cache/forecast summarization and location context
  - `backend/app/sensor_ingest.py`: sensor ingestion from Selangor APIs + helpers
  - `backend/app/models.py`: Pydantic request models (currently includes `UserReportCreate`)
  - `backend/tests/test_home_preview.py`: tests for home preview payload logic/cache/fallback behavior
  - `backend/tests/test_weather_context.py`: tests for weather summarization/cache/rate-limit behavior
  - `backend/requirements.txt`: Python dependencies for backend runtime
  - `backend/reset_and_seed_sensors.py`, `seed_sensor_readings.py`, `seed_sensors.py`: local data seeding scripts
  - `backend/migrate_sensor_coords.py`, `inspect_postgres_schema.py`, `fix_sensors_units.py`: schema/data maintenance scripts
  - `backend/ops/systemd/waterstatus-api.service`: systemd unit for backend service
  - `backend/ops/systemd/waterstatus-quick-tunnel.service`: systemd unit for Cloudflare quick tunnel
  - `backend/ops/print_tunnel_url.sh`: helper to extract current quick-tunnel URL
- Frontend
  - `frontend/package.json`: app scripts and dependencies
  - `frontend/react-router.config.ts`, `frontend/vite.config.ts`, `frontend/tsconfig.json`: app/toolchain config
  - `frontend/app/routes.ts`: route map
  - `frontend/app/root.tsx`: global layout/navigation shell
  - `frontend/app/lib/api.ts`: backend base URL detection (`VITE_API_BASE_URL` / `VITE_API_BASE`)
  - `frontend/app/lib/weather.ts`: weather API calls and shaping
  - `frontend/app/routes/home.tsx`, `sensors.tsx`, `posts.tsx`, `users.tsx`, etc.: page implementations
  - `frontend/Dockerfile`: container build/run for frontend app server

## Frontend Details
- Stack: React 19, React Router 7, Vite, TypeScript, Tailwind CSS v4, Recharts, Leaflet/React-Leaflet, Framer Motion.
- Route entry: `frontend/app/routes.ts`
- API integration:
  - `frontend/app/lib/api.ts` chooses API base from env first, then localhost/origin fallback.
  - Most API usage is in `home.tsx`, `sensors.tsx`, `posts.tsx`, `users.tsx`, `weather.ts`.
- PWA assets present (`manifest`, icons, touch icon) under `frontend/public/`.

## Backend/API Details
- Framework: FastAPI + Uvicorn.
- Route families found in `backend/app/main.py`:
  - Health/readiness: `/`, `/health`, `/healthz`, `/readyz`
  - Sensors/readings: `/sensors`, `/sensors/{sensor_id}`, `/sensor-readings`, `/sensor-readings/latest-by-sensor`, `/sensors/{sensor_id}/readings`, ingest endpoint
  - Weather: `/weather/forecast-summaries`, `/weather/location-context`
  - Auth/admin/users: `/auth/register`, `/auth/login`, `/admin/users`, `/users*`
  - Reports: `/reports*`, `/user-reports*`, likes endpoint
  - Checkout placeholder: `/create-checkout-session` (currently returns fake URL)
- Sensor ingest supports periodic background ingest and manual ingest endpoint.

## Database / Storage Details
- `backend/app/db.py` behavior:
  - Uses Postgres if `DATABASE_URL` is set.
  - Falls back to SQLite at `SQLITE_PATH` (default `backend/app/local_data.sqlite`) when `DATABASE_URL` is absent.
- Collections/tables represented for sensors, readings, users, reports, user reports.
- Some scripts (`inspect_postgres_schema.py`, `migrate_sensor_coords.py`) explicitly read `backend/.env` for `DATABASE_URL`.

## Raspberry Pi / Deployment / Hosting Notes
- Render:
  - Backend service: `water-status-api` (Python, health check `/healthz`)
  - Frontend service: `water-status` static site built from `frontend`
- GitHub Actions:
  - Scheduled workflow pings backend health endpoint every 5 minutes.
- Raspberry Pi operations:
  - Systemd units and quick tunnel docs in `backend/README.md` and `backend/ops/systemd/*`
  - Recovery and LAN/VNC/cloudflared notes in `.raspi-recovery.md`

## Environment Variables (Names Only)
- Backend
  - `DATABASE_URL`
  - `SQLITE_PATH`
  - `SENSOR_INGEST_INTERVAL_SECONDS`
  - `SENSOR_INGEST_ENABLED`
  - `PASSWORD_HASH_ITERATIONS`
  - `AUTH_TOKEN_TTL_SECONDS`
  - `AUTH_TOKEN_SECRET`
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
  - `OPEN_METEO_TIMEOUT_SECONDS`
  - `OPEN_METEO_CACHE_TTL_SECONDS`
  - `OPEN_METEO_ERROR_CACHE_TTL_SECONDS`
  - `OPEN_METEO_STALE_IF_ERROR_TTL_SECONDS`
  - `OPEN_METEO_COORD_PRECISION`
  - `OPEN_METEO_DEFAULT_BATCH_LIMIT`
  - `OPEN_METEO_LOCATION_RADIUS_KM`
  - `OPEN_METEO_LOCATION_FRAME_COUNT`
  - `PORT` (deployment runtime)
- Frontend
  - `VITE_API_BASE_URL` (canonical)
  - `VITE_API_BASE` (legacy alias)
- Render linkage
  - `RENDER_EXTERNAL_URL` (used in `render.yaml` wiring)

## Common Commands (Only What Exists in Repo)
- Root
  - `pip install -r requirements.txt`
- Backend
  - `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000`
  - `cd backend && python3 reset_and_seed_sensors.py`
  - `cd backend && python3 seed_sensor_readings.py`
  - `cd backend && python3 -m app.shift_dummy_timestamps`
  - `cd backend && ./venv/bin/python inspect_postgres_schema.py`
  - `cd backend && ./venv/bin/python migrate_sensor_coords.py`
- Frontend
  - `cd frontend && npm install`
  - `cd frontend && npm run dev`
  - `cd frontend && npm run build`
  - `cd frontend && npm run start`
  - `cd frontend && npm run typecheck`
- Docker (frontend)
  - `cd frontend && docker build -t my-app .`
  - `cd frontend && docker run -p 3000:3000 my-app`

## Known Project Conventions
- Keep backend and frontend concerns separated by folder.
- Prefer env-based configuration for API base and DB.
- Keep Pi ops/systemd artifacts versioned under `backend/ops`.
- WaterStatus prompts should be file/path-targeted first; avoid token-heavy tools unless explicitly requested or required.
- Do not use screen capture/screenshots, browser/web access, UI inspection tools, computer-use/desktop automation, or broad auto-scripted repo scans by default.
- For UI issues, ask Codex to inspect components/styles and use user-provided screenshot descriptions instead of opening screen tools unless truly required.
- Fallback behavior is intentional in backend:
  - SQLite fallback when Postgres unavailable
  - Fallback sensors/readings when persistent DB path fails

## Known Issues / TODO Signals Found
- Checkout endpoint is currently placeholder logic returning fake URL (`/create-checkout-session`).
- `backend/app/main.py` imports `stripe`, but checkout flow is not yet fully integrated.
- No explicit lint/test scripts in `frontend/package.json`; validation often relies on `typecheck` and targeted runtime checks.

## What ChatGPT Should Know Before Writing Codex Prompts
- This is a full-stack repo; prompts should always specify whether scope is backend, frontend, or both.
- Many backend behaviors are in a single large file (`backend/app/main.py`); ask Codex to inspect route-specific sections first.
- API base URL wiring is centralized; frontend network issues often trace to `frontend/app/lib/api.ts` or env vars.
- DB mode (Postgres vs SQLite fallback) materially changes behavior; prompts should state expected backend mode.
- Pi ops files exist; for deployment prompts, clarify whether target is Render, Raspberry Pi, or both.
- WaterStatus prompts should be file/path-targeted and command-minimal by default.
- Do not ask Codex to use screen capture/screenshots, browser/web access, UI inspection tools, computer-use/desktop automation, or broad auto-scripts unless explicitly requested or not solvable from repo files/logs.

## Do Not Assume
- Do not assume Stripe checkout is production-ready.
- Do not assume Postgres is always active; SQLite fallback exists.
- Do not assume all routes are covered by automated tests.
- Do not assume frontend has lint/test commands unless explicitly added.
- Do not assume quick tunnel URL is stable; it changes and may require manual env updates.

## Codex Should Usually Inspect These Files First
- `README.md`
- `render.yaml`
- `backend/app/main.py`
- `backend/app/db.py`
- `backend/app/weather_context.py`
- `backend/tests/test_home_preview.py`
- `backend/tests/test_weather_context.py`
- `frontend/package.json`
- `frontend/app/lib/api.ts`
- `frontend/app/routes.ts`
- `frontend/app/root.tsx`
- Primary affected route file(s), usually:
  - `frontend/app/routes/home.tsx`
  - `frontend/app/routes/sensors.tsx`
  - `frontend/app/routes/posts.tsx`
  - `frontend/app/routes/users.tsx`
