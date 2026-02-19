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
