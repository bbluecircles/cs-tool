# CS Tool — Frontend

React + TypeScript + Vite + Tailwind. Talks to the FastAPI backend at
`http://127.0.0.1:8000` via Vite's dev proxy.

## Requirements

- Node.js 20 or newer (LTS recommended)
- The backend running on port 8000

## First-time setup

```powershell
# From the frontend directory
npm install
```

## Run (dev)

```powershell
npm run dev
```

Open http://localhost:5173. The API status indicator in the top-right turns
green once the backend's `/health` endpoint is reachable.

## Build (prod)

```powershell
npm run build
```

Outputs static files to `dist/`. In production we serve these from the
FastAPI backend (see backend README) so the whole app is one service.

## Project layout

```
src/
  api/          Typed API client + per-resource query hooks
  components/   App-level layout primitives (AppShell, etc.)
  features/     Feature folders: auth/, users/, ...
  hooks/        Reusable hooks
  lib/          Shared helpers
  styles/       Global Tailwind CSS entrypoint
  App.tsx       Route map
  main.tsx      Providers (QueryClient, Router)
```

## Palette

All colors come from the Intellimed palette, encoded as Tailwind tokens in
`tailwind.config.js`. Use the tokens (`bg-primary-900`, `text-secondary-500`,
etc.) — do not use raw hex values in components.
