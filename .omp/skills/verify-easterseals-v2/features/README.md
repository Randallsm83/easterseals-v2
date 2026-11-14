# Easterseals v2 verification map

This directory is the maintained source for verifying the user-facing behavior of the Easterseals v2 research tracker. Read this index before driving the app, then use the matching feature file as the recipe. Every command below is `$S` = `.omp/skills/verify-easterseals-v2/scripts/control.sh`, run from the repo root.

## Baseline preconditions

- `$S launch` printed `READY` and `$S doctor` reports only `ok` lines.
- The SPA is at `http://127.0.0.1:41400`, the API at `http://127.0.0.1:41401/api`, and the API has the scratch DB `<state>/run/easterseals.db` open.
- A fresh launch has an empty DB: no configurations, participants, sessions or sequences.
- Never drive an instance this run did not start (the user's dev server is on 3000/5173 with `server/data/easterseals.db`).

## Driving conventions

- Navigate through the top nav links (`Home`, `Participants`, `Configurations`, `Session Sequences`, `Sequence Runs`, `Analytics`, `Compare`, `Monitor`) or the buttons a user would press, not by typing API calls.
- Prefer accessible names: button and link names, `<label>` text, placeholders, the `Balance` output, the `Participant apparatus` group.
- The three default screen inputs all render as `Click Me` buttons; the first one in DOM order is `Left`, the only rewarded input of a stock configuration.
- Configurations are created through the UI with a unique name; journeys that need one reuse `Verify fixed 10s` or create it.
- Sessions end by themselves at the configured time limit; wait for the end message rather than navigating away.

## Proof and skip reporting

- Each `$S drive` call writes `evidence/<RUN_ID>/<journey>-<HHMMSS>/` with a screenshot and ARIA snapshot per step, DB read-backs, downloads and `result.json`.
- A pass needs both the visible end state and the stored rows that should have changed.
- Report a failing step with its `result.json` error and the `-FAILED` screenshot; do not rerun until green and report only the last attempt.
- Do not report a sub-feature as verified when the journey that covers it was not run in this pass.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control.sh`, `Gotchas`.

## Features

- [Configurations](./configurations.md): create a reusable session configuration and see it listed.
- [Run a session](./session-run.md): start a participant session from a configuration, earn rewards by clicking, auto-end at the time limit.
- [Analytics](./analytics.md): per-session results tiles, persistent session notes, JSON export.
- [Live Monitor](./live-monitor.md): watch a running session from a second tab via server-sent events.
- [Session sequences](./sequences.md): chain configurations, run them back to back with one balance, review the run in Sequence Runs.

Not mapped yet: Participants (archive/restore), Compare (multi-session charts), editing/archiving configurations, keyboard and gamepad inputs, pauses and changeover delay.
