---
name: verify-easterseals-v2
description: Drive the Easterseals v2 behavioral research tracker (React/Vite SPA over Express + better-sqlite3) in a real headless Chrome against a disposable SQLite file, and capture screenshots, ARIA snapshots and DB rows as proof. Use when you need to show that configurations, participant sessions, session sequences, analytics or the live monitor actually work after a change, or when a running verification instance looks wrong.
---

# verify-easterseals-v2

Researchers build **configurations** (inputs, reward schedule, time/money limits), run a participant through a **session** (big `Click Me` buttons, balance counter, automatic end at the time limit), chain configurations into **session sequences**, watch a session on the **Live Monitor** (SSE), and read results on **Analytics**. The primary surface is the browser SPA; the Express API is its backend. Everything below drives the SPA the way a researcher or participant would and checks the stored rows afterwards.

All commands use the helper `scripts/control.sh` in this skill directory. From the repo root:

```bash
S=.omp/skills/verify-easterseals-v2/scripts/control.sh
```

Map of user features: [features/README.md](features/README.md). Written against commit `b71a136`.

## Launch

```bash
$S launch
```

What it does (same shape as the repo's own `tests/fixtures.ts`):

- Resolves Node 22 through `mise where node@22` (installs it with mise if missing). Node 26 cannot build `better-sqlite3` 11.x; Node 22 uses its prebuilt binary.
- If `node_modules/better-sqlite3` does not load, runs `npm ci` in the checkout with that Node (lockfile unchanged).
- Starts the API as `node --import tsx server/src/index.ts` with `PORT=41401`, `NODE_ENV=test`, `DATABASE_PATH=<state>/run/easterseals.db` (fresh, empty; tables are created on boot, there is no seed data).
- Starts Vite from `client/` on `127.0.0.1:41400` with `VITE_API_URL=http://127.0.0.1:41401/api`, using `scripts/vite.config.mjs` (the repo config plus `cacheDir` under the state dir, so nothing is written to the checkout).
- Ready means usable: `/api/health` is ok, `/api/configurations` returns a JSON array, the SPA shell is served and Vite transforms `src/main.tsx`. It prints one line:
  `READY run=<RUN_ID> web=http://127.0.0.1:41400 api=http://127.0.0.1:41401/api db=<path> evidence=<dir>`

Only one instance at a time: the ports are fixed. `launch` refuses if either port already has a listener or a previous run was not cleaned up. Never point this at the user's own `npm run dev` (ports 3000/5173, DB `server/data/easterseals.db`).

## Doctor

```bash
$S doctor
```

Read-only. Every line must be `ok`; exit code 1 otherwise. It checks: both recorded PIDs alive; ports 41401/41400 are owned by exactly those PIDs; `/api/health`; the SPA shell; the API process has the scratch DB open and does not have the checkout's `server/data/` DB open; checkout `HEAD` is still the commit it was launched from (if not, clean up and relaunch); Node version. Run it first whenever anything looks off.

## Drive

```bash
$S drive <journey> [--key value ...]
```

`scripts/drive.mjs` runs headless Google Chrome (`/Applications/Google Chrome.app`) through the repo's own `playwright-core` (installed with `@playwright/test`). It only uses user handles: link and button names, label text, placeholders, the `Balance` output and the `Participant apparatus` group. It never calls the API directly; the DB is read with `sqlite3 -readonly -json` to confirm side effects. Exit 0 and a `PASS <journey> {...} evidence=<dir>` line mean every assertion held.

| Journey | What it does | Options (defaults) |
| --- | --- | --- |
| `configurations` | Home → New Configuration → name + time limit → Create Configuration; card listed; row stored | `--name` (`Verify config <ms>`), `--time-limit` (10) |
| `session-run` | Configurations → Start Session → participant → Create Session → Start Session → clicks the rewarded input → time-limit end; Home shows Completed | `--config` (`Verify fixed 10s`), `--participant` (`V<n>`), `--clicks` (10), `--time-limit` (10) |
| `analytics` | `/analytics/<id>` tiles match the stored end event; Save Notes persists across reload; Export JSON downloads | `--session` (required, an ended session) |
| `live-monitor` | Monitor → Connect with the session id in a second tab; participant clicks; monitor Total Clicks updates; Session Ended | `--config`, `--participant`, `--clicks` (10), `--time-limit` |
| `sequences` | Session Sequences → Create Sequence (config twice) → Start → participant → Start Sequence → clicks in both conditions → Session complete.; Sequence Runs row Completed | `--config`, `--participant`, `--clicks`, `--name` |

`session-run`, `live-monitor` and `sequences` first create the named configuration through the UI when the scratch DB has none (default: the stock three-button setup, only `Left` rewarded at $0.05 every 10 clicks, `--time-limit` seconds). Each run of these takes about `time-limit` seconds per session because the app ends sessions on its own timer.

Typical full pass:

```bash
$S drive configurations --name "Verify fixed 10s"
$S drive session-run --participant P100
$S drive analytics --session P100-1
$S drive live-monitor --participant P200 --clicks 5
$S drive sequences --participant P300
```

Ad-hoc read of the scratch DB (read-only): `$S db "select sessionId, endedAt from sessions"`.

For a step no journey covers, write a short Playwright snippet in the same style (import `chromium` from `playwright-core`, `chromium.launch({ channel: 'chrome' })`, base URL from `doctor`) and keep its artifacts under the same evidence dir.

## Evidence

Location: `${XDG_STATE_HOME:-$HOME/.local/state}/verify-easterseals-v2/evidence/<RUN_ID>/`

- `server.log`, `vite.log`: full output of the two processes for this run.
- `<journey>-<HHMMSS>/`: one directory per drive invocation:
  - `NN-<step>.png` full-page screenshot and `NN-<step>.aria.yml` ARIA snapshot after every user action (`-FAILED` suffix on the step that broke);
  - `NN-<label>.db.json` the SQL and rows read back from the scratch DB;
  - downloads the journey triggered (for example `session-<id>-data.json`);
  - `result.json`: journey, options, pass/fail, error, per-step timing/URL/detail, browser console errors.

Proof standard:

- Drive the real user path (nav links, forms, buttons). Do not seed with `curl` POSTs or test-only endpoints and call it verified.
- Capture the action and the resulting state: the screenshot after the click plus the row it wrote (`session_event_log`, `sessions.endedAt`, `session_notes`, `sequence_runs`).
- Check visible numbers against stored ones (Analytics tiles vs the stored `end` event; Monitor Total Clicks vs click rows).
- A `FAIL` line is a finding, not something to retry until green. Read `result.json` and the `-FAILED` screenshot first.
- No mocks: the API, SQLite and SSE are all real; there are no external services.

## Cleanup

```bash
$S cleanup
```

Sends SIGTERM to the two PIDs this run recorded (SIGKILL after 10 s), never by process name; reports (does not touch) any other listener left on the ports; deletes `<state>/run/` (scratch DB, WAL files, Vite cache, pid files). The `evidence/<RUN_ID>/` directory is kept and listed. Run it after every attempt, including failed ones. `cleanup` is safe to run when nothing is running.

## Helpers

- `scripts/control.sh launch | doctor | drive <journey> [--key value ...] | db "<sql>" | cleanup` (bash; needs `mise`, `curl`, `lsof`, `sqlite3`, `git`).
- `scripts/drive.mjs`: the browser journeys; run it through `control.sh drive`, which passes `ES_WEB`, `ES_API`, `ES_DB`, `ES_EVID`.
- `scripts/vite.config.mjs`: wraps `client/vite.config.ts` and moves Vite's optimizer cache to `$ES_VITE_CACHE`.

Notes:

- The API calls `app.listen(PORT)` without a host, so port 41401 listens on all interfaces while the instance is up. It holds only scratch data.
- The repo's own regression suite (`npm test`: Playwright spinning up its own API/Vite/temporary DB per worker) is separate from this skill and was not run by it.
- Keep the map honest as the app changes with `/maintain-verification-skill`.
