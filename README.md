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
- Node.js >= 18
- npm or pnpm

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
