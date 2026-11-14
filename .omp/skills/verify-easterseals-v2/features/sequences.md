# Session sequences

A researcher saves an ordered list of configurations as a session sequence, starts it for a participant, and the participant plays the conditions back to back on one screen with a single continuous balance; the finished run is listed on Sequence Runs as Completed.

## Sub-features

- `sequence-create` builds a named sequence from the `Configuration` select with `Add Configuration` and `Save Sequence`.
- `sequence-start` launches the sequence for a participant via `Start <name>` → `Participant ID` → `Start Sequence`, opening `/sequence-run?runId=<uuid>`.
- `sequence-advance` moves to the next condition automatically when a condition's time limit ends, keeping the earned balance.
- `sequence-complete` shows `Session complete.` after the last condition and stores the run as `completed`.
- `sequence-history` lists the run on Sequence Runs with status `Completed`.

## How to get to it (user POV)

- Session Sequences (top nav) → `Create Sequence` → name, configurations → `Save Sequence`.
- Session Sequences → `Start <sequence name>` on a saved sequence → participant → `Start Sequence`.
- Sequence Runs (top nav) for the history list; a run's detail page is `/sequence-history/run?runId=<uuid>`.

## Driving it with control.sh

Preconditions:

- Doctor is all `ok`.
- A configuration named by `--config` exists or can be created (default `Verify fixed 10s`, 10 s).
- The participant ID is new.

- **Create.** Run `$S drive sequences --participant P300`. Choose `Session Sequences`, `Create Sequence`, type into `Sequence name`, pick `Verify fixed 10s` in `Configuration` and choose `Add Configuration` twice, then `Save Sequence`; a heading with the sequence name appears (step `create-sequence`). `NN-sequence-saved.db.json` shows positions 0 and 1 with that configId.
- **Start.** Choose `Start <name>`, fill `Participant ID`, choose `Start Sequence`. URL `/sequence-run?runId=…` with the `Balance` output visible (step `start-sequence`).
- **Condition 1.** When the run is at position 0 and `Click Me` is enabled, click it 10 times. Balance reads `$0.05` (step `condition-1-clicks`).
- **Condition 2.** After the first time limit the next condition starts by itself; 10 more clicks bring Balance to `$0.10` (step `condition-2-clicks`).
- **Complete.** `Session complete.` appears (step `sequence-complete`). `NN-sequence-run.db.json`: status `completed`, `currentPosition` 2, `sequenceBalance` 10; `NN-sequence-run-entries.db.json`: both sessions started and ended.
- **History.** Choose `Sequence Runs`. The row for `P300` shows `Completed` (step `sequence-runs-history`).

## Gotchas

- In a sequence the balance has no `/ $limit` suffix and continues across conditions; single sessions show `$x.xx / $10000.00`.
- There is no on-screen "next condition" prompt in this flow; the journey waits on `sequence_runs.currentPosition` (read-only) and an enabled `Click Me` before clicking the next condition.
- Leaving the run page mid-sequence interrupts the run (status `interrupted`), which the app does not replay; start a new run instead of resuming.
- Planned sessions are created at launch with `startedAt` null; only the started ones carry participation data.
