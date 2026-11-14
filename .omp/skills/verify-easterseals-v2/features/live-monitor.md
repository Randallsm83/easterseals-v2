# Live Monitor

A researcher watches a running session from another tab or device: after connecting with the session id, the monitor shows `Live`, updates elapsed time and click counts as the participant clicks, and switches to `Session Ended` with a link to Analytics when the session finishes.

## Sub-features

- `monitor-connect` accepts a session id on `/monitor` and opens `/monitor/<id>` with status `Live`.
- `monitor-stream` updates the `Total Clicks` tile from server-sent events while the participant clicks.
- `monitor-end` shows `Session Ended` and `Session has ended. Final data is now available in Analytics.` after the time limit.

## How to get to it (user POV)

- Monitor (top nav) → type the session id into the `e.g. participant1-3` box → `Connect`.
- Start New Session page, after `Create Session` → `Open Monitor` (opens `/monitor/<id>` in a new tab).

## Driving it with control.sh

Preconditions:

- Doctor is all `ok`.
- The participant ID is new (the journey creates session `<id>-1` itself).

- **Create.** Run `$S drive live-monitor --participant P200 --clicks 5`. The first tab creates the session as in [session-run](./session-run.md) and stops on `Start Session →`.
- **Connect.** A second tab chooses `Monitor`, fills `e.g. participant1-3` with `P200-1`, chooses `Connect`; URL `/monitor/P200-1`, status `Live` (step `monitor-connect`, screenshot of the monitor tab).
- **Participant clicks.** The first tab chooses `Start Session →` and clicks `Click Me` 5 times (step `participant-starts`).
- **Stream.** The monitor's `Total Clicks` tile reaches `5` without reload (step `monitor-shows-clicks`).
- **End.** After the time limit the monitor shows `Session Ended` and the Analytics banner (step `monitor-sees-end`); `NN-session-events.db.json` shows 5 `click` rows and one `end`.

## Gotchas

- Connect before starting: the SSE snapshot carries current events but not earlier pause history, so active-time figures after a late connect are only partial (documented in AGENTS.md).
- The status badge text is exactly `Live`; `Live Monitor` is the page heading. Match exactly.
- The monitor tab is a separate page in the same browser context; screenshots for monitor steps come from that tab.
