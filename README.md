# River & Farm Guardian

## Pi Run Command (Backend)

Run on Raspberry Pi from the project root:

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Use `uvicorn` **without** `--reload` for always-on deployments.

## Postgres Diagnostics / Coord Backfill

```bash
cd backend
./venv/bin/python inspect_postgres_schema.py
./venv/bin/python migrate_sensor_coords.py
```

## Production Security Requirements

Set production mode explicitly:

```bash
ENVIRONMENT=production
```

In production mode, backend startup now requires:

* `DATABASE_URL` (Postgres is mandatory in production)
* `AUTH_TOKEN_SECRET` (strong, non-default value)
* `ADMIN_USERNAME` (non-default value)
* `ADMIN_PASSWORD` (strong, non-default value)

SQLite fallback remains available for local/development only (when production mode is not enabled).

For CORS, configure explicit origins only:

* `FRONTEND_ORIGIN` for the deployed frontend URL (Render static service URL)
* Optional `ALLOWED_ORIGINS` as a comma-separated allowlist for additional trusted origins

Wildcard CORS origins are not allowed in production mode.
