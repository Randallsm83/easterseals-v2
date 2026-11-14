# Analytics

A researcher opens a finished session on the Analytics Dashboard to read its overview tiles (End Reason, Total Clicks, Money Earned and timing), write session notes that persist, and export the session data as JSON or CSV.

## Sub-features

- `analytics-tiles` shows End Reason, Total Clicks and Money Earned that agree with the stored `end` event.
- `analytics-notes` saves free-text notes (`✓ Saved`) that survive a reload and land in `session_notes`.
- `analytics-export-json` downloads `session-<id>-data.json` containing the session id.

## How to get to it (user POV)

- Home → `View` on a session row (goes to `/analytics/<sessionId>`).
- Analytics (top nav) → choose the participant, then the session, in the two selects.
- Configurations → a session id link in a configuration card's session list (planned sequence sessions have no link).

## Driving it with control.sh

Preconditions:

- Doctor is all `ok`.
- An ended session exists; run [session-run](./session-run.md) first (for example `P100-1`). Without an `end` event the journey fails by design.

- **Open.** Run `$S drive analytics --session P100-1`. Heading `Analytics Dashboard` and the `End Reason` tile load (step `open-session-analytics`); `NN-expected-from-db.db.json` holds the stored end event.
- **Tiles.** The value above each label reads `Time Limit`, `10`, `$0.05` for the stock session-run; the journey compares each tile to the DB, not to constants.
- **Notes.** Type into the textarea with placeholder `Add observations, notes, or comments about this session...` and choose `Save Notes`. `✓ Saved` appears (step `save-session-notes`); after reload the textarea still holds the text (step `notes-survive-reload`) and `NN-session-notes.db.json` shows it.
- **Export.** Choose `Export JSON`. The download `session-P100-1-data.json` is saved next to the screenshots and its `sessionId` matches (step `export-json`).

## Gotchas

- `Total Clicks` appears more than once on the page; the tile read uses the first, in Session Overview.
- `Export CSV` is only rendered when the session has chart data; `Export JSON` is always shown once a session is loaded.
- `✓ Saved` disappears after 2 s; take the proof from the DB row and the reload, not only the badge.
- End Reason reads `In Progress` for a session without an `end` event and `Interrupted` for an interrupted sequence member.
