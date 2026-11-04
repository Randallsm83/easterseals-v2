# AGENTS.md

Guidance for agents working in this repository. Source code takes precedence if documentation drifts.

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

Browser/API regression tests use Playwright against real Express and a temporary SQLite database. Run `npm test`; setup and focused commands are documented in `DEVELOPMENT.md` under "Regression tests".

## Architecture

### Monorepo Structure

npm workspaces contain `client/` (React SPA) and `server/` (Express API), running independently in development. DreamHost serves the deployed frontend from `~/es2.randall.codes/` and proxies `/api` to the API on port 8080. Express can also serve `client/dist/` with a non-API SPA fallback when started in production mode.

### Server (`server/src/`)

- `index.ts` — Express app setup, route mounting, optional production static serving, and CORS (open in development; production allows `https://es2.randall.codes` and `https://api.es2.randall.codes`)
- `db/index.ts` — Single Better-SQLite3 instance, `initializeDatabase()` creates tables + runs migrations, exports a `statements` object of prepared statements (used directly by route handlers)
- `routes/` — Express routers: `configurations`, `sequences`, `sequenceRuns`, `sessions`, `events`, and `participants`
- `types/index.ts` — Zod schemas are the source of truth; TypeScript types are all derived via `z.infer<...>`
- `live/sessionEmitter.ts` — In-memory pub/sub (`Map<sessionId, Set<Callback>>`) powering SSE live monitoring

**Session ID format**: auto-generated as `${participantId}-${sequenceNumber}` (e.g., `P001-3`)

**SSE stream** (`GET /api/sessions/:sessionId/stream`): sends an initial snapshot of existing events on connect, then streams live events via `sessionEmitter`. Heartbeat every 25s. Header `X-Accel-Buffering: no` disables nginx buffering.

**Event types**: stored and streamed events include `start`, `click`, `end`, `pause`, and `resume`. `LogEventSchema` in `routes/events.ts` accepts only `start`, `click`, `pause`, and `resume`; the dedicated completion endpoint records and streams `end` atomically. Keep new event kinds aligned with the relevant write schema and `LiveEvent.type`.

**Event log shape**: events stored as JSON strings in `session_event_log.value`. Click events have two legacy formats + the current format; `normalizeClickValue()` in `sessions.ts` handles all three.

**End event includes** `timeLimitReached` and `moneyLimitReached` booleans — the Analytics "End Reason" tile reads these to display *Time Limit* / *Money Limit* / *Manual* / *In Progress*.

### Client (`client/src/`)

- `App.tsx` — React Router routes wired here; all nav links live in the top nav
- `lib/api.ts` — `ApiClient` class (singleton `api`); base URL auto-detects: `VITE_API_URL` env var → `/api` in prod → `http://localhost:3000/api` in dev
- `lib/normalizeConfig.ts` — **Critical**: `normalizeConfig(raw)` converts old 3-button format (`leftButton`/`middleButton`/`rightButton`) to the current unified `inputs[]` model. Always call this before using a stored config.
- `lib/activeTime.ts` — Shared historical pause-exclusion math for Analytics and Session Comparison. It pairs ordered pause/resume rows and maps event timestamps to active elapsed time.
- `lib/rewardSchedules.ts` — Shared reward schedule helpers. It owns interval sanitation, variable interval generation, point-schedule averaging/balancing, runtime target selection, and display labels. Use these helpers instead of duplicating reward math in pages or stores.
- `lib/useExternalInput.ts` — Hook handling keyboard (`keydown` → `event.code` match) and gamepad (RAF polling with edge detection). Gamepad input codes are formatted as `gp-{gpIndex}-btn-{btnIndex}` or `gp-{gpIndex}-axis-{axisIndex}-{pos|neg}`.
- `stores/useSessionStore.ts` — Zustand store tracking live session state: per-input click and interval counters, reward targets/sequences, banked changeover-delay rewards, money, and limit flags
- `pages/` — `Session.tsx` runs standalone sessions and sequence conditions; `SequenceRunHistory.tsx` and `SequenceRunDetail.tsx` provide read-only results; `Analytics.tsx` handles per-session and aggregate views; `LiveSession.tsx` consumes SSE
- `types/index.ts` — Client-side type definitions mirroring server types (kept manually in sync; not auto-generated)

### Session sequences and run results

Before changing sequence persistence, transitions, interruption, or result retrieval, read [Sequence runs](DEVELOPMENT.md#sequence-runs).

- Participant `/sequence-run?runId=...` mounts the session runner. Researcher `/sequence-history` and `/sequence-history/run?runId=...` remain read-only and never mount participation. Keep these entry points separate (`client/src/App.tsx (103-109)`).
- Both run entry paths have unconditional static fallbacks; run identity belongs in the query string, not deployment-time run-ID enumeration (`client/scripts/generate-spa-fallbacks.mjs (4-15)`).
- Researcher details retain a keyed per-run state boundary and cancel stale request updates. Missing or empty IDs show an error without fetching the collection (`client/src/pages/SequenceRunDetail.tsx (9-36)`).
- Launched conditions and session membership are frozen. Repeated configurations retain distinct session records; planned entries are not active results. Use the retained run rather than mutable setup data when displaying historical conditions.

### Data Model

Two config formats coexist due to legacy data migration:
- **Legacy** (`LegacyBaseConfig`): `leftButton`/`middleButton`/`rightButton` + `buttonActive` field + global `moneyAwarded`/`awardInterval`
- **Current** (`BaseConfig`): unified `inputs: InputConfig[]` where each input has its own reward settings and `type: 'screen' | 'keyboard' | 'gamepad_button' | 'gamepad_axis'`

`normalizeConfig()` on the client and `normalizeClickValue()` on the server bridge old and new formats. New features should only use the current `BaseConfig`/`InputConfig` model.

**Optional participant/pause fields on `BaseConfig`** (all default to safe values via `normalizeConfig`):
- `showMoneyToParticipant?: boolean` — default `true`. Hides the money counter from the participant on the session screen when `false`.
- `pauseEnabled?: boolean` — enables mid-session pauses.
- `pauseTrigger?: 'any' | 'rewarded'` — default `'rewarded'`. Counts only rewarded responses or any response toward the pause threshold.
- `pauseAfterResponses?: number` — number of qualifying responses between pauses.
- `pauseDurationSeconds?: number` — length of each pause.
- `pauseResumeMode?: 'auto' | 'manual'` — default `'auto'`.
- `pauseResumeBinding?: { type: 'any' | 'keyboard' | 'gamepad_button' | 'gamepad_axis'; inputCode?: string; inputLabel?: string }` — for manual mode, choose any input or bind a specific key / gamepad button / axis.

While paused, `Session.tsx` clears the time-limit `setTimeout` and snapshots remaining ms; on resume the timer is rescheduled with the remaining ms so the session time limit pauses with the participant. Pause/resume are also logged as `pause` and `resume` events.

**Changeover delay fields on `BaseConfig`** (session-wide, defaulted by `normalizeConfig`):
- `changeoverDelayEnabled?: boolean` — default `false`.
- `changeoverDelayMs?: number` — default `1000`.
- `handleInputActivation` is the single path for screen and physical inputs. Every activation updates the input timestamp used to test whether other inputs have been quiet for the configured delay.
- An earned reinforcer inside the delay window is banked in `pendingRewards`; the reward schedule still advances. It pays on the next activation of the same input after the window clears, never on a timer or through another input.
- At most one reinforcer pays per response. If paying a banked reinforcer overlaps a newly earned one, the newly earned reinforcer remains banked.
- Click events carry `codWithheld` and `codPending`; time- and money-limit end events carry `pendingRewards`.
- `normalizeClickValue()` rebuilds click data through an explicit allow-list. Add new click fields there and test with `!== undefined` because `false` and `0` are meaningful.

**Reward schedule fields on `InputConfig`**:
- `awardInterval` remains the configured exact interval for fixed schedules and the target average for variable/custom schedules.
- `rewardSchedule?: 'fixed' | 'variable' | 'custom'` defaults to `fixed` for older configs.
- `rewardIntervals?: number[]` stores the point-by-point sequence when `rewardSchedule` is `custom`.

Reward schedule behavior:
- Fixed schedules award exactly every `awardInterval` activations.
- Variable generated schedules build a session-scoped interval sequence from `awardInterval`; the sequence length is derived from the session time limit.
- Custom point-by-point schedules consume `rewardIntervals` in order and repeat the list when the participant earns more rewards than the configured list covers.
- The Configuration UI lets researchers generate low/medium/high variation point schedules, resize point count, balance the last point, and see the live total/average. Do not make researchers calculate the interval total manually.

Source references: `client/src/types/index.ts (28-49)`, `server/src/types/index.ts (30-50)`, `client/src/lib/rewardSchedules.ts (3-212)`, `client/src/pages/ConfigurationSetup.tsx (62-160)`, `client/src/pages/ConfigurationSetup.tsx (1074-1140)`, `client/src/stores/useSessionStore.ts (14-19)`.

### State Reset Across Sessions
The Zustand store in `client/src/stores/useSessionStore.ts` resets *all* session-scoped flags (`moneyLimitReached`, `timeLimitReached`, `sessionActive`, plus per-input counters and `pendingRewards`) inside `setConfig` and `resetSession`. This must stay in place — without it, a flag from a previously completed session in the same browser tab will leak into the next session and prevent rewards from firing, and a banked changeover-delay reward would pay out in the wrong session. `Session.tsx` likewise clears `lastActivationAtRef` before `startSession()`.

### Logging end events
`finishSession` in `Session.tsx` captures final counters from `useSessionStore.getState()` before awaiting all accepted event writes, including the response that triggers a money-limit ending. Only then does `api.endSession` submit the snapshot and condition timestamp. The server atomically records `end` and `endedAt`, then broadcasts SSE; do not restore separate `api.logEvent({ event: 'end' })` writes. A synchronous ending latch blocks input and duplicate endings; any failed write stops participation without claiming success. Shutdown from an old pending write must not stop a different session that has since replaced the global store.

### Active-time analytics
`client/src/lib/activeTime.ts` owns historical pause-exclusion math. `buildActiveTimeline(startMs, endMs, pauseEvents)` pairs `pause`/`resume` rows into clamped intervals and returns `pausedMs`, `activeMs`, and `activeMsAt(atMs)`. It tolerates duplicate pauses, orphan resumes, unparseable timestamps, and a trailing unclosed pause closed at `endMs`. Analytics and Session Comparison consume it; do not duplicate this math.

`LiveSession.tsx` tracks streaming pause/resume events with refs rather than `buildActiveTimeline`. The current SSE snapshot has no prior pause history, so a monitor opened or reconnected after a pause cannot reconstruct that earlier paused duration; its active-time figure is authoritative only for pause events observed while connected.

`GET /api/sessions/:sessionId/data` returns ordered `pauseEvents: { event, timestamp }[]` via `getPauseResumeEvents`. Do not use `getSessionEventByType` for this because it ends in `LIMIT 1`. Duration math must stay inside `session_event_log`, using its ISO-8601 event timestamps. Standalone `sessions.startedAt` defaults to SQLite `CURRENT_TIMESTAMP`; planned run sessions start with `NULL` and receive the accepted start event's ISO timestamp. Session endings use ISO timestamps (`server/src/db/index.ts (378-387)`, `server/src/routes/events.ts (54-56)`).

Analytics and Session Comparison expose an `Active Time` / `Wall Clock` toggle (default `active`) that drives timeline x-axes and both response-rate bases. `ChartDataPoint` carries `timeElapsed` and `activeElapsed`, CSV exports both columns, and `responsesPerMinute()` is the shared rate helper.

### Auto-resume timer closure
Timers invoke the latest callbacks through `resumeSessionRef`, `handleTimeLimitEndRef`, and `pauseSessionRef`. Pause guards and the ending latch are checked synchronously through refs so stale callbacks cannot resume a stopped session. Keep the ref indirection when changing timer-driven callbacks.

### Deployment

- Auto-deploys on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`)
- SSH into `easterseals@vps54643.dreamhostps.com`, force-syncs the checkout to `origin/main`, builds, copies `client/dist/*` to `~/es2.randall.codes/`, redeploys pm2 `es2-api` on port 8080 via `$HOME/bin/pm2-keepalive.sh`, and regenerates SPA fallback files against the live API
- DreamHost panel proxies `/api` → `localhost:8080`
- SQLite DB lives at `server/data/easterseals.db` (auto-created; not committed)
- Deployment script must fail fast. Keep `set -e` and the `git fetch --prune origin main` + `git reset --hard origin/main` pair so a blocked or diverged checkout cannot produce a green-but-stale deployment.
- `client/scripts/generate-spa-fallbacks.mjs` always generates the fixed participant and researcher run entry paths. API-enabled deployment additionally generates ID-based fallbacks for existing sessions/configurations; it does not enumerate sequence-run IDs.
- `client/vite.config.ts` explicitly allows both the current workspace path and its native real path for dev serving. This avoids Vite file-serving failures when a Windows checkout path resolves through another drive.
- Current deployed release and verification summary: [Latest Release](README.md#latest-release). Publishing `main` deploys production; distinguish local validation from a completed deployment.
- Keep production verification read-only. Use temporary SQLite databases and isolated frontends for synthetic participant/researcher workflows; preserve verified database and compiled-artifact rollback copies before release.

Deployment source references: `.github/workflows/deploy.yml (19-30)`, `client/scripts/generate-spa-fallbacks.mjs (4-67)`, `client/vite.config.ts (7-29)`.

## Server Import Convention

The server uses ESM (`"type": "module"`). All internal imports **must include the `.js` extension** even for `.ts` source files:

```typescript
import { statements } from '../db/index.js';   // ✓
import { statements } from '../db/index';       // ✗
```

## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues for `Randallsm83/easterseals-v2`. Read `docs/agents/issue-tracker.md` before tracker operations.

### Triage labels

Use the five default triage labels. Read `docs/agents/triage-labels.md` before classifying issues.

### Domain docs

Use a single-context layout. Read `docs/agents/domain.md` before domain exploration or documentation changes.
