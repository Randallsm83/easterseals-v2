# Run a session

A researcher starts a session for a participant from a configuration card; the participant clicks the on-screen `Click Me` buttons, the balance grows on the reward schedule, and the session ends itself at the time limit and shows as Completed on Home.

## Sub-features

- `session-create` enters a participant ID, previews `This will be session #N for participant <id>`, and creates session `<id>-<N>`.
- `session-start` opens the participant screen at `/session/<id>` with balance `$0.00 / $10000.00` and logs a `start` event.
- `session-reward` pays $0.05 for every 10th click on the rewarded `Left` input and logs one `click` event per click.
- `session-time-limit` ends the session at the time limit: message `Time limit reached. Session ended.`, buttons disabled, `end` event with `timeLimitReached`, `sessions.endedAt` set.
- `session-listed` shows the session as `Completed` on Home.

## How to get to it (user POV)

- Configurations → `Start Session` on a configuration card → `Participant ID *` → `Create Session` → `Start Session →`.
- Home → `Start Session` button (goes to Configurations), then as above.

## Driving it with control.sh

Preconditions:

- Doctor is all `ok`.
- The participant ID has no prior sessions if you expect session `#1` (the journey reads the preview and asserts the created id matches it).

- **Create session.** Run `$S drive session-run --participant P100` (creates `Verify fixed 10s` first if missing). Steps `open-configurations` → `choose-start-session` → `enter-participant` → `create-session` end with a `Start Session →` button and the session id `P100-1` in a code block; `NN-session-created.db.json` shows the row with `endedAt` null.
- **Start.** Choose `Start Session →`. URL `/session/P100-1`; the `Balance` output reads `$0.00 / $10000.00`; a `start` row exists (step `enter-session`).
- **Click.** Click the first `Click Me` 10 times (`--clicks`). Balance reads `$0.05 / $10000.00` (step `click-rewarded-input`).
- **Time limit.** Wait. `Time limit reached. Session ended.` appears and `Click Me` is disabled (step `time-limit-ends-session`). DB read-backs: `sessions.endedAt` set; events `start` 1, `click` 10, `end` 1; end event `timeLimitReached` 1, `moneyCounter` 5, `totalClicks` 10.
- **Listed.** Choose `Home`. The row for `P100` shows `Completed` (step `home-lists-session`).

## Gotchas

- All screen inputs are named `Click Me`; use the first one for the rewarded `Left` input of a stock configuration.
- The session timer starts when `/session/<id>` loads, not when `Create Session` is pressed. Clicking slowly past the time limit drops clicks.
- `Saving session...` shows briefly before the end message while the end event is written; wait for the final message.
- Leaving the participant page before the time limit leaves the session without an end event (`Active` on Home); that is a different journey, not a pass.
