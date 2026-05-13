# CS Tool

Internal user management tool for Customer Service.

Lets CS agents list, filter, inline-edit, and create users in the main
application's database. No delete functionality by design.

## Stack

- **Backend:** FastAPI (Python 3.11+), SQLAlchemy Core, PyMySQL, argon2,
  PyJWT, MariaDB
- **Frontend:** React + TypeScript, Vite, Tailwind CSS, TanStack Query,
  TanStack Table
- **Deployment:** Windows (Python as a service via `nssm`, frontend built
  as static files and served from FastAPI)

## Repository layout

```
backend/    FastAPI service — see backend/README.md
frontend/   React app — see frontend/README.md
```

## Build status

This project is being built in staged increments:

- [x] **Stage 1** — Scaffold: project structure, config, DB connection,
      migration SQL, health endpoint, frontend shell, color palette.
- [x] **Stage 2** — Auth: login endpoint, JWT in httpOnly cookies, login
      page, protected routes, silent refresh on 401.
- [x] **Stage 3** — Users list: server pagination/filter/sort, TanStack
      Table, password reveal with audit logging.
- [x] **Stage 4** — Inline edit: per-column scope registry, preview with
      impact counts, scope-aware confirm modal, two-phase apply
      (transactional writes + post-commit refresh/grants), audit log.
- [x] **Stage 5** — Create user: multi-step modal (customer → datasets
      → user) with async user_id availability check, customer creation,
      post-commit refresh + grants, result toast.
- [x] **Stage 6** — Polish: retry-refresh/retry-grants admin actions,
      admin audit viewer, tier enforcement scaffolding, error boundary,
      session-expired toast, unsaved-edits guards on navigation and
      logout.

## Quick start

### 1. Database migration

As a MariaDB admin, run `backend/db/migrations/001_init.sql` after editing
it to set a real password for the `cs_tool_svc` service account. The
migration creates the service user, grants it what it needs, and creates
the `myuser.cs_audit_log` table.

### 2. First CS agent

There is **no separate CS-agents table**. CS agents are main-app users
whose `customer_code` equals the configured admin code (default `717`).
Make sure at least one `secure.customer_users` row exists with
`customer_code = 717` and `disable = 0` before you try to log in.

### 3. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: set DB_PASSWORD (service account) and JWT_SECRET to a real
# 64-char random (python -c "import secrets; print(secrets.token_urlsafe(64))")
# Adjust ADMIN_CUSTOMER_CODE if 717 is wrong for your setup.
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 4. Frontend (separate terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and log in using the credentials of any
main-app user under `customer_code = 717`.
