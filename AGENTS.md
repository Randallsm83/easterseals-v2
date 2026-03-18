# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Purpose

Behavioral research tracking application for studying button-click patterns and reward systems. Researchers configure sessions (inputs, reward schedules, time/money limits), run participants through sessions, and analyze results. Supports screen buttons, keyboard, and gamepad inputs.

## Key Technologies

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS + shadcn/ui (Radix primitives), Recharts, Zustand, React Router v7
- **Backend**: Express 4 + TypeScript (ESM), Better-SQLite3, Zod validation, Server-Sent Events
- **Build**: TypeScript compiled with `tsc` (server), `tsc -b && vite build` (client)
- **Dev**: `tsx watch` for server hot reload, Vite HMR for client

## Commands

All commands run from the repo root unless noted.

```bash
# Development (both client + server)
npm run dev

# Individual
npm run dev:server    # server on :3000
npm run dev:client    # client on :5173

# Build
npm run build          # both
npm run build:server   # server → server/dist/
npm run build:client   # client → client/dist/

# Production
npm start              # runs server/dist/index.js with NODE_ENV=production

# Lint & type-check (runs in each workspace)
npm run lint
npm run type-check

# Workspace-specific lint/type-check
npm run lint --workspace=server
npm run type-check --workspace=client
```

No test suite exists in this project.

## Architecture

### Monorepo Structure

npm workspaces with `client/` (React SPA) and `server/` (Express API). In production, the server serves client static files from `client/dist/` and handles all routing; in dev they run independently.

### Server (`server/src/`)

- `index.ts` — Express app setup, CORS (dev: open, prod: `es2.randall.codes`), route mounting, static file serving in prod
- `db/index.ts` — Single Better-SQLite3 instance, `initializeDatabase()` creates tables + runs migrations, exports a `statements` object of prepared statements (used directly by route handlers)
- `routes/` — Four Express routers: `configurations`, `sessions`, `events`, `participants`
- `types/index.ts` — Zod schemas are the source of truth; TypeScript types are all derived via `z.infer<...>`
- `live/sessionEmitter.ts` — In-memory pub/sub (`Map<sessionId, Set<Callback>>`) powering SSE live monitoring

**Session ID format**: auto-generated as `${participantId}-${sequenceNumber}` (e.g., `P001-3`)

**SSE stream** (`GET /api/sessions/:sessionId/stream`): sends an initial snapshot of existing events on connect, then streams live events via `sessionEmitter`. Heartbeat every 25s. Header `X-Accel-Buffering: no` disables nginx buffering.

**Event log shape**: events stored as JSON strings in `session_event_log.value`. Click events have two legacy formats + the current format; `normalizeClickValue()` in `sessions.ts` handles all three.

### Client (`client/src/`)

- `App.tsx` — React Router routes wired here; all nav links live in the top nav
- `lib/api.ts` — `ApiClient` class (singleton `api`); base URL auto-detects: `VITE_API_URL` env var → `/api` in prod → `http://localhost:3000/api` in dev
- `lib/normalizeConfig.ts` — **Critical**: `normalizeConfig(raw)` converts old 3-button format (`leftButton`/`middleButton`/`rightButton`) to the current unified `inputs[]` model. Always call this before using a stored config.
- `lib/useExternalInput.ts` — Hook handling keyboard (`keydown` → `event.code` match) and gamepad (RAF polling with edge detection). Gamepad input codes are formatted as `gp-{gpIndex}-btn-{btnIndex}` or `gp-{gpIndex}-axis-{axisIndex}-{pos|neg}`.
- `stores/useSessionStore.ts` — Zustand store tracking live session state: per-input click counts, interval counters, money counter, limit flags
- `pages/` — One file per route; `Session.tsx` is the active session runner, `Analytics.tsx` handles per-session and aggregate views, `LiveSession.tsx` consumes SSE
- `types/index.ts` — Client-side type definitions mirroring server types (kept manually in sync; not auto-generated)

### Data Model

Two config formats coexist due to legacy data migration:
- **Legacy** (`LegacyBaseConfig`): `leftButton`/`middleButton`/`rightButton` + `buttonActive` field + global `moneyAwarded`/`awardInterval`
- **Current** (`BaseConfig`): unified `inputs: InputConfig[]` where each input has its own reward settings and `type: 'screen' | 'keyboard' | 'gamepad_button' | 'gamepad_axis'`

`normalizeConfig()` on the client and `normalizeClickValue()` on the server bridge old and new formats. New features should only use the current `BaseConfig`/`InputConfig` model.

### Deployment

- Auto-deploys on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`)
- SSH into `easterseals@vps54643.dreamhostps.com`, pulls, builds, copies `client/dist/*` to `~/es2.randall.codes/`, restarts pm2 (`es2-api`, cluster mode) on port 8080
- DreamHost panel proxies `/api` → `localhost:8080`
- SQLite DB lives at `server/data/easterseals.db` (auto-created; not committed)

## Server Import Convention

The server uses ESM (`"type": "module"`). All internal imports **must include the `.js` extension** even for `.ts` source files:

```typescript
import { statements } from '../db/index.js';   // ✓
import { statements } from '../db/index';       // ✗
```
