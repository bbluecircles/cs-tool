# CS Tool — Backend

FastAPI service for the Customer Service user management tool.

## Requirements

- Python 3.11 or newer
- MariaDB reachable on the network, with a dedicated service account (see `db/migrations/001_init.sql`)
- Windows 10/11 or Windows Server

## First-time setup

```powershell
# From the backend directory
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Copy the example env file and fill it in
copy .env.example .env
notepad .env
```

You will need to fill in:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` — the service-account credentials
- `JWT_SECRET` — generate with `python -c "import secrets; print(secrets.token_urlsafe(64))"`
- `PASSWORD_PEPPER` — same generation, different value
- `CORS_ORIGINS` — your frontend dev URL, e.g. `http://localhost:5173`

## Database migrations

The `db/migrations` folder holds plain SQL files. Run them manually, in order, against your MariaDB instance before first startup:

```powershell
mysql -h <host> -u <admin_user> -p < db\migrations\001_init.sql
```

The migrations create `myuser.cs_agents` and `myuser.cs_audit_log`, and insert a bootstrap admin row you can use to log in the first time.

## Run (dev)

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check: http://127.0.0.1:8000/health

OpenAPI docs (dev only): http://127.0.0.1:8000/docs

## Run (production, as a Windows service)

Install `nssm` (Non-Sucking Service Manager) and register a service that runs:

```
<path>\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Set the startup directory to the backend folder.

## Project layout

```
app/
  api/         Route handlers, one file per resource
  core/        Config, security, logging
  db/          Connection management, raw-SQL helpers
  schemas/     Pydantic request/response models
  services/    Business logic (user CRUD, refresh, grants, audit)
  main.py      FastAPI app, middleware, router wiring
db/migrations/ Versioned SQL migrations
tests/         Pytest tests
```
