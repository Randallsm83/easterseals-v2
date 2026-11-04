# Easterseals Research Study v2

A modern behavioral research tracking application for studying button-click patterns and reward systems.

## Features

- 🎯 **Session Configuration**: Customizable buttons, rewards, and session limits
- 🎲 **Configurable Reward Schedules**: Fixed intervals, generated variable averages, or point-by-point custom schedules
- 📊 **Enhanced Visualizations**: Interactive charts with real-time updates
- 🔄 **Live Monitoring**: Watch sessions as they happen
- 📈 **Analytics Dashboard**: Aggregate statistics across sessions, with end-reason indicator
- 📤 **Data Export**: Export to CSV/JSON for external analysis
- ⏸️ **Periodic Pauses**: Configurable mid-session pauses with auto- or manual-resume
- **Active-Time Analytics**: Exclude logged pauses from charts and response-rate calculations, with an active-time/wall-clock toggle
- **Changeover Delay**: Optionally bank reinforcers after input changes until the participant responds on the rewarded input outside the delay window
- 🙈 **Participant Display Control**: Optionally hide the money counter from the participant
- 🌓 **Dark Mode**: Built-in theme support
- 📱 **Responsive**: Mobile-first design
- **Reusable Session Sequences**: Save named, ordered configuration lists, including repeated conditions, and revise them for future use

## Tech Stack

### Frontend
- React 19 + TypeScript
- Vite (build tool)
- Tailwind CSS + shadcn/ui (styling)
- Recharts (visualizations)
- Zustand (state management)

### Backend
- Express + TypeScript
- Better-SQLite3 (database)
- Zod (validation)
- Server-Sent Events (real-time)

## Getting Started

### Prerequisites
- Node.js supported by Vite: `^20.19.0 || >=22.12.0`
- npm (comes with Node.js)

### Installation

```bash
# Install dependencies
npm install

# Development mode (runs both client and server)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Development URLs
- Client: http://localhost:5173
- Server: http://localhost:3000

## Project Structure

```
easterseals-v2/
├── client/          # React frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── lib/         # Utilities
│   │   ├── stores/      # Zustand stores
│   │   └── types/       # TypeScript types
│   └── public/
├── server/          # Express backend
│   ├── src/
│   │   ├── routes/      # API routes
│   │   ├── db/          # Database logic
│   │   └── types/       # TypeScript types
│   └── data/        # SQLite database
└── package.json     # Root workspace config
```

## Usage

1. **Setup Session**: Configure session parameters, button styles, inputs, reward schedules, pauses, and an optional changeover delay
2. **Run Session**: Participants click buttons to earn points
3. **View Analytics**: Analyze click patterns and performance metrics
4. **Export Data**: Download session data for further analysis

### Author a session sequence

1. Save the configurations you want to use through **Configurations**.
2. Open **Session Sequences**, choose **Create Sequence**, and enter a name.
3. Select a saved configuration and choose **Add Configuration** for each entry. Add the same configuration again to create orders such as A → B → A. Archived configurations are labeled and remain selectable.
4. Use **Move up**, **Move down**, or **Remove** to adjust entries, then choose **Save Sequence**. Controls support keyboard navigation; dragging is not required.
5. Reopen a saved setup with **Edit** to rename it or change its entries. Saved changes survive page reload. **Cancel** discards the current draft.
6. Choose **Delete** and confirm to remove an obsolete setup. Its configurations and recorded sessions remain intact.

Names must contain non-whitespace text and be at most 200 characters; each sequence must contain at least one saved configuration. Failed saves display an error and keep the draft. Configurations referenced by a saved sequence or any sequence run cannot be deleted. Configuration edits remain available and affect future launches only.

### Run a session sequence

1. Open **Session Sequences**, choose **Start** on a saved setup, enter one **Participant ID**, and choose **Start Sequence**.
2. The complete order and configuration contents are frozen at launch. The participant responds on the same apparatus while each condition ends according to its existing time limit, money cap, and continuation setting.
3. The next condition accepts input only after the previous condition's accepted events and completion have been saved. There are no intermediate setup screens, countdowns, results, or transition messages. Responses during saving are ignored; held physical inputs must be released before they can count in the next condition.
4. When enabled by the current condition, the money display shows the first starting balance plus rewards earned throughout the run, without a per-session limit denominator. Later starting balances affect only their own session's accounting.
5. After the final save, the apparatus remains disabled with **Session complete.** Each condition has its own session record and frozen configuration for individual analysis.

A failed write stops participation without retrying or advancing. The runner attempts to mark the run interrupted and explicitly reports if that status could not be saved. Deleting the reusable setup preserves run identity, snapshots, sessions, and events.

Closing, reloading, or navigating away from an active participant runner stops that run rather than resuming, replaying, or skipping conditions. The browser attempts to save interruption immediately. If that request is lost, reopening the participant URL checks saved participation and marks the run interrupted before allowing any input. Until that check reaches the API, history can still show the last saved status. A failed interruption save is disclosed; it is not presented as confirmed interruption.

The participant URL uses the fixed path `/sequence-run?runId=…`. Keep the run ID in the query string when sharing or bookmarking it. Its static entry point exists before any run is launched, so new runs can be reloaded or reopened without another deployment.

Completed runs stay completed when reopened. Interrupted runs retain completed sessions and already saved partial responses, without fabricating a session ending or a time/money-limit reason. Responses that never reached storage cannot be recovered. For further participation, return to **Session Sequences** and deliberately launch a new run with the participant ID; this creates separate records and leaves the interrupted run unchanged.

### Review sequence run results

1. Open **Sequence Runs** to find persisted runs by participant, frozen sequence name, run ID, and lifecycle status. This history remains available after the reusable setup is deleted.
2. Open a run to inspect its conditions in launch order. Repeated configurations occupy separate numbered positions with distinct session IDs. **Planned** means participation never started; **Active**, **Completed**, and **Interrupted** describe the saved state of each started session.
3. Open a started session's **Analytics** link for its existing individual results. Conditions and response classification use the configuration frozen at launch, not later source edits. Interrupted sessions retain saved partial responses without inventing an end event or limit reason.
4. Select two to five started sessions and choose **Compare selected sessions**. The existing comparison keeps independent session-relative timelines and its **Active Time** / **Wall Clock** controls. Planned conditions cannot be selected. No sequence-wide charts or aggregate statistics are added.

History is read-only: viewing results does not open or resume the participant apparatus. Status is the last persisted state, not a new abandonment detector. Historical run references continue protecting source configurations and constituent sessions from deletion.

Sequence work is **unreleased**; deployment remains a separate step.

## Unreleased

### Sequence review corrections (#55)

- Prevented a delayed launch acknowledgement from navigating back into participation after the researcher leaves the launch form.
- Preserved configured reward audio at normal completion while retaining playback cancellation on failure or abandonment.
- Reconciled normalized response identities with frozen legacy configurations while preserving nested and flat legacy records, without rewriting historical events or changing research accounting.
- Replaced per-run participant paths with a fixed static entry point and query-based run identity, supporting reload/reopen for runs created after deployment.

Local verification: all 77 browser/API/isolated-SQLite regression tests passed. Workspace, explicit client application, and strict test-source typechecks, lint, and production builds passed. Routing tests served the generated production frontend without an SPA wildcard and launched runs after fallback generation.

An observed participant/researcher smoke used that static topology: left-rewarded → right-rewarded → left-rewarded conditions rejected the wrong button in every condition, preserved independent session accounting, accumulated only earned sequence rewards, and completed all three native reward sounds. Completed participant reload remained unchanged. Frozen legacy analytics retained 100% accuracy after source edits and setup deletion, with keyboard comparison and configuration-deletion protection exercised. Separate standards and specification reviews of the complete feature against `7832326` reported no remaining findings.

No push or deployment was performed. Physical gamepad button/axis boundary checks remain unavailable; actual BFCache restoration was subsequently verified in the acceptance audit below. Existing Browserslist freshness and bundle-size warnings remain.

### Per-ticket acceptance audit (#55–#60)

Audited local candidate `8708358` against the parent specification and each child ticket independently, rather than treating the combined code review as acceptance of every checklist.

| Ticket | Acceptance result |
| --- | --- |
| #55 — parent specification | All 37 user stories passed. Implementation, testing, and scope requirements were mapped separately; physical-controller smoke remains unavailable. |
| #56 — durable completion | 8/8 acceptance criteria passed. |
| #57 — sequence authoring | 8/8 acceptance criteria passed. |
| #58 — frozen execution | 17/18 criteria passed; the remaining mixed criterion includes fulfilled browser-smoke/documentation requirements but unavailable physical gamepad button/axis proof. |
| #59 — interruption | 8/8 acceptance criteria passed. |
| #60 — retained individual results | 9/9 acceptance criteria passed. |

The audit reused the existing 77-passed regression run on this candidate; it did not rerun the full suite. Fresh browser/API/isolated-database probes verified standalone completion, authoring CRUD with keyboard reorder/removal and reload persistence, future launches after source/order edits, final-condition continuation through time expiry, a close sequence time/money race with exactly one advancement, malformed later-condition rejection without partial records, and actual comparison chart values on both time bases.

Actual full-Chromium BFCache restoration was observed through trusted native persisted `pagehide` and `pageshow` events for the same document. The restored runner rechecked persisted state, remained interrupted, preserved completed/partial/planned records, and accepted no resumed participation. This supersedes the earlier BFCache limitation; ordinary reload was not counted as cache-restoration proof.

A separate isolated upgrade smoke initialized a populated database with the exact pre-feature `7832326` database module, then started the current server against that database. All original configuration, standalone-session, event, note, and archived-participant rows, value types/bytes, table definitions, columns, and indexes remained unchanged after initialization and a new sequence launch. Existing APIs retained the original records; integrity and foreign-key checks passed. This was a synthetic local compatibility check, not access to the production database.

No product defect was demonstrated by this audit. Architecture and excluded-feature constraints were inspected in source and are not presented as runtime checks. Physical input remains a separate limitation: the browser exposed no gamepad after trusted interaction, while Windows exposed a native Razer Tartarus V2 joystick interface. No physical button/axis boundary action was performed, and simulated input is not hardware proof. No issue state, commit, push, or deployment was changed by this audit.

Subsequent tracker reconciliation recorded the per-ticket acceptance evidence and local commit references, updated the checklists, and closed GitHub issues #55–#60 as **locally implemented—not deployed**. The parent [acceptance record](https://github.com/Randallsm83/easterseals-v2/issues/55#issuecomment-6625341745) includes the complete 88-row mapping and links to each child’s evidence. The parent physical-controller item and #58’s mixed final criterion remain unchecked; browser-smoke/documentation portions passed, while actual physical button/axis proof remains unavailable under #58’s explicitly permitted reporting condition. Fresh GitHub reads verified every published body, evidence comment, and closed state. This reconciliation created no commit, push, release, or deployment.

### Ordered sequence run results (#60)

- Added researcher run history and ordered detail views with frozen identifying context, persisted lifecycle states, and separate records for repeated conditions.
- Linked started sessions to existing analytics and comparison while excluding planned conditions and preserving the five-session comparison limit and time bases.
- Preserved completed and partial results after setup deletion. Comparison now uses the last saved response balance when no end event exists.
- Added real browser/API/isolated-SQLite coverage for frozen repeated conditions, retained completed and interrupted data, standalone compatibility, active/wall-clock results, comparison selection limits, and clearing an in-flight comparison.

Local verification: all 67 browser/API regression tests passed. Workspace, explicit client application, and strict test-source typechecks, lint, and production builds passed. An observed researcher browser smoke opened retained run history after setup deletion, inspected frozen individual analytics, and compared completed and partial sessions with the saved response balance. Production fallback generation was exercised against the isolated API for history, retained run details, and individual analytics.

No push or deployment was performed. Physical gamepad hardware was not exercised by this read-only results change. The production build retains its Browserslist freshness and bundle-size warnings.

### Abandoned sequence runs (#59)

- Added immediate owner-scoped shutdown on runner navigation and page exit, plus persisted interruption on re-entry when a run has already started.
- Prevented delayed response/completion acknowledgements and restored browser documents from restarting participation. Completed runs remain completed after late interruption requests.
- Preserved saved completed and partial results without inventing an ending. Further participation requires a deliberately launched new run.
- Added real browser/API/isolated-SQLite regression coverage for reload, close/reopen with lost unload delivery, saved partial results, fresh launch, delayed-save races, completed re-entry, and interruption-save failures.

Local verification: all 64 browser/API regression tests passed. Workspace typechecks, explicit client application and strict test-source typechecks, lint, and production builds passed. Separate observed browser smoke runs saved rewarded responses, reloaded and closed/reopened into the interrupted screen, and confirmed saved balances/responses with no end event or next-session start. A fresh launch through the researcher UI created a separate run for the same participant.

Standards, specification, and error-handling reviews found no remaining defects. Physical gamepad hardware and actual BFCache restoration were not exercised; BFCache handling was source-reviewed.

### Frozen session sequence execution (#58)

- Added participant launch, immutable ordered conditions, automatic durable transitions, continuous earned balance, and neutral final completion on the disabled apparatus.
- Reset local reward schedules, counters, limits, pause state, changeover-delay rewards/history, and timers between conditions. Held keys, gamepad buttons, and axes require release before a response in the next condition.
- Added transactional run lifecycle and reward accounting, frozen session-data retrieval, and historical configuration/session deletion protection. Existing lists and monitoring distinguish planned and interrupted conditions.
- Added real browser/API/isolated-SQLite coverage for repeated conditions, both ending modes, hidden money, continuation, delayed/failed writes, rollback, retained snapshots, state resets, and simulated physical-input boundaries. Physical controller verification is separate.

Local verification: all 57 browser/API regression tests passed, along with workspace typechecks, strict test-source typechecking, lint, and production builds. A separate observed researcher/participant A → B → A smoke run retained the apparatus and three independent records with the correct earned balance. Standards and spec reviews have no remaining findings. Physical gamepad hardware was not verified.

### Reusable session sequence authoring (#57)

- Added persistent named setup creation, listing, reopening, renaming, reordering, repeated entries, removal, and deletion.
- Added validated transactional sequence APIs and reference-backed configuration-deletion protection without rewriting historical research data.
- Added real browser/API/isolated-SQLite regression coverage for A → B → A persistence, revisions, invalid submissions, and deletion guards.
- Authoring does not change standalone sessions or add sequence execution.

### Durable session completion

- Session completion waits for every accepted event write, including the response that reaches the money limit or is still saving at time expiry. Writes preserve response acceptance order even when timestamps match.
- Pause thresholds and automatic pause durations take effect at response acceptance, without waiting for network saves.
- Final response counters and rewards are captured synchronously; completion retains that session's snapshot even if the researcher navigates to another session while saving.
- One completion request records the end event and session end timestamp in a database transaction. The participant sees successful completion only after acknowledgement.
- A failed event or completion write stops participation and reports the save failure without automatically retrying or inventing a successful ending.
- Browser/API regression tests run against a disposable SQLite database. See [Regression tests](DEVELOPMENT.md#regression-tests).

## Latest Release

The current production release adds pause-aware analytics, a configurable changeover delay, and configurable reward schedules for rewarded inputs, and hardens production deployment.

### Active-time analysis

- Analytics and Session Comparison default to active time and can switch to wall-clock time.
- Duration, paused time, active time, and responses per minute are calculated from logged `pause`/`resume` timestamps.
- CSV exports include wall-clock and active-time columns.
- The Live Monitor reports active elapsed time and active responses per minute while connected.

Implementation references: `client/src/lib/activeTime.ts (26-79)`, `client/src/pages/Analytics.tsx (290-299)`, `client/src/pages/Analytics.tsx (426-440)`, `client/src/pages/SessionComparison.tsx (114-126)`, `client/src/pages/LiveSession.tsx (292-312)`, `server/src/routes/sessions.ts (169-180)`.

### Changeover delay

- Configuration Setup exposes a session-wide enable switch and delay in milliseconds.
- A reinforcer earned inside the delay window is banked rather than lost, then paid on the next qualifying response on that rewarded input after the window clears.
- Analytics, CSV export, and the Live Monitor identify changeover-delay withholding.

Implementation references: `client/src/pages/ConfigurationSetup.tsx (589-624)`, `client/src/pages/Session.tsx (315-405)`, `client/src/stores/useSessionStore.ts (137-153)`, `client/src/pages/Analytics.tsx (860-866)`.

### Reward schedule options

- **Fixed**: awards exactly every configured number of activations.
- **Variable generated**: generates session-scoped reward intervals that average to the configured target interval. The generated sequence length is derived from the configured session time limit.
- **Point-by-point**: lets researchers define each reward interval directly, see the running total and average, generate low/medium/high variation schedules, and balance the last point to hit the target average. If the participant earns more rewards than the defined point list covers, the list repeats.

Implementation references: `client/src/types/index.ts:7`, `client/src/lib/rewardSchedules.ts (3-212)`, `client/src/pages/ConfigurationSetup.tsx (62-160)`, `client/src/pages/ConfigurationSetup.tsx (1074-1140)`, `client/src/stores/useSessionStore.ts (14-17)`.

### Deployment updates

Production deploys still run through GitHub Actions on `main`, but the workflow now fails fast, force-syncs the VPS checkout to `origin/main`, builds the app, redeploys `es2-api` through the supervised PM2 keepalive helper, and regenerates static SPA fallbacks for direct route access. Local Vite dev serving also explicitly allows both the workspace path and its real filesystem path so linked Windows checkouts can load `/src/main.tsx` reliably.

Implementation references: `.github/workflows/deploy.yml (19-30)`, `client/scripts/generate-spa-fallbacks.mjs (4-63)`, `client/vite.config.ts (7-29)`.

## License

ISC
