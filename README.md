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

Sequence work is **unreleased**. Abandonment/re-entry recognition ([#59](https://github.com/Randallsm83/easterseals-v2/issues/59)) and ordered run history ([#60](https://github.com/Randallsm83/easterseals-v2/issues/60)) remain separate work; do not release the partial sequence feature.

## Unreleased

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
