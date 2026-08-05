# Development Guide

## Project Status

### ✅ Completed
- Project structure setup with monorepo architecture
- Backend API with Express + TypeScript + Better-SQLite3
- Database schema with foreign key constraints and indexing
- Zod schemas for configuration/session types and validated API inputs
- React frontend with Vite + TypeScript
- Tailwind CSS + shadcn/ui component library setup
- React Router for navigation
- API client with type-safe methods
- Base UI components (Button, Card, Input, Label)
- Home page with session list and statistics
- Session setup with full button configuration (screen + physical inputs)
- Active session page with clickable styled buttons
- Click tracking and event logging
- Session timer/limit enforcement
- Configuration management with archive/unarchive
- Participant management
- **Unified flexible input model** (gamepad, keyboard, screen buttons)
- **Analytics Dashboard** — per-input stats, click timeline, money chart
- **Session notes** — save text observations to any session
- **Data export** — CSV and JSON
- **Configuration editing** — edit existing configs via pencil icon
- **Light/Dark mode toggle** — persisted to localStorage
- **Live session monitoring** — researcher watches session in real time from a separate device via SSE
- **Session comparison** — side-by-side stats and timelines for up to 5 sessions
- **Input color swatches** —  16-color preset palette for physical inputs
- **End session at money limit** — explicit "End session when money limit is reached" toggle in the configurator
- **Hide money from participant** — `showMoneyToParticipant` setting hides the money counter on the session screen (researcher still sees it in the live monitor)
- **Configurable mid-session pauses** — pause after N rewarded or any responses; auto-resume after the configured duration or manually resume with any input or a specific binding. The participant's session time limit stops while paused.
- **Pause/resume events** — logged via `api.logEvent` and streamed over SSE
- **End Reason in Analytics** — Session Overview tile shows *Time Limit* / *Money Limit* / *Manual* / *In Progress*
- **Participant & Pause options in Analytics** — Configuration card shows the new options (money display, pauses on/off, pause schedule, resume mode)
- **Configurable reward schedules** — rewarded inputs can use fixed exact intervals, generated variable schedules that average to the configured target, or point-by-point custom schedules with live average/total feedback
- **Reward schedule display** — configuration lists, start-session summaries, and analytics distinguish fixed intervals, generated averages, and custom point schedules
- **Active-time analytics** — Analytics and Session Comparison default to pause-excluded timelines with a wall-clock toggle; both report active and wall-clock responses per minute, and CSV exports include both time bases
- **Live active-time monitoring** — the SSE monitor tracks pause/resume events while connected and reports active elapsed time plus active responses per minute
- **Changeover delay** — an optional session-wide delay banks reinforcers after input changes and pays them on the next clean response on the same rewarded input; click telemetry and CSV/Analytics surfaces identify withheld rewards
- **Reliable auto-resume** — pause timers invoke the latest resume callback so automatic pauses complete instead of stalling at zero
- **SPA fallback generation** — production builds generate static fallback pages for direct navigation to app routes, including existing sessions and configurations during deploy
- **Production deploy hardening** — GitHub Actions deploy fails fast, force-syncs the VPS checkout to `origin/main`, redeploys `es2-api` through the supervised PM2 keepalive helper, and regenerates fallbacks afterward

### 🎯 Possible Future Enhancements

1. **Enhanced Animations** - Button click animations, point popup effects
2. **Session Templates** - Save and reuse session configurations
3. **Advanced Analytics** - Heat maps, trend analysis, statistical tests
4. **PDF Export** - Formatted report output
5. **Participant-level notes** - Notes scoped to participant rather than individual sessions
6. **Bulk session operations** - Archive, export, delete multiple sessions at once

## Getting Started

### Prerequisites
- Node.js >= 18
- npm (comes with Node.js)

### Installation
Dependencies are already installed. To reinstall if needed:
```bash
npm install
```

### Development

**Run both client and server:**
```bash
npm run dev
```

**Run client only:**
```bash
npm run dev:client
```

**Run server only:**
```bash
npm run dev:server
```

### URLs
- Client: http://localhost:5173
- Server API: http://localhost:3000/api
- Health check: http://localhost:3000/health

## Project Structure

```
easterseals-v2/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   │   └── ui/         # shadcn/ui components
│   │   ├── lib/            # Utilities (API client, active-time math, reward schedules, helpers)
│   │   ├── pages/          # Route pages
│   │   ├── stores/         # Zustand state management
│   │   ├── types/          # TypeScript interfaces
│   │   ├── App.tsx         # Main app with routing
│   │   └── main.tsx        # Entry point
│   ├── public/
│   ├── scripts/            # Build/deploy helper scripts
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   └── vite.config.ts
│
├── server/                 # Express backend
│   ├── src/
│   │   ├── db/             # Database setup and queries
│   │   ├── routes/         # API route handlers
│   │   ├── types/          # TypeScript interfaces + Zod schemas
│   │   └── index.ts        # Server entry point
│   ├── data/               # SQLite database file (auto-created)
│   ├── package.json
│   └── tsconfig.json
│
├── package.json            # Root workspace config
├── README.md
└── DEVELOPMENT.md          # This file
```

## API Endpoints

### Sessions
- `GET /api/sessions` - List all sessions with stats
- `GET /api/sessions/:sessionId/data` - Get full session data (config + click/start/end events + ordered pause/resume events)
- `POST /api/sessions` - Create new session (returns session ID)
- `POST /api/sessions/:sessionId/start` - Start a created session
- `POST /api/sessions/:sessionId/end` - End a session
- `DELETE /api/sessions/:sessionId` - Delete session
- `GET /api/sessions/:sessionId/notes` - Get session notes
- `PUT /api/sessions/:sessionId/notes` - Save session notes
- `GET /api/sessions/:sessionId/stream` - SSE stream for live monitoring

### Events
- `POST /api/events` - Log a session event (`start` | `click` | `end` | `pause` | `resume`)
- `GET /api/events/:sessionId` - Get events for a session
- Click event values may include `codWithheld` and `codPending`; time- and money-limit end events include `pendingRewards`

### Configurations
- `GET /api/configurations` - List configurations
- `GET /api/configurations/:id` - Get single configuration
- `POST /api/configurations` - Create configuration
- `PUT /api/configurations/:id` - Update configuration
- `POST /api/configurations/:id/archive` - Archive
- `POST /api/configurations/:id/unarchive` - Unarchive

### Participants
- `GET /api/participants` - List participants
- `POST /api/participants` - Create participant
- `GET /api/participants/:id/sessions` - Sessions for a participant

## Database Schema

### session_configuration
- sessionId (TEXT, PRIMARY KEY)
- config (TEXT, JSON)
- createdAt (DATETIME)

### session_event_log
- id (INTEGER, PRIMARY KEY AUTOINCREMENT)
- sessionId (TEXT, FOREIGN KEY)
- event (TEXT: 'start', 'click', 'end', 'pause', 'resume')
- value (TEXT, JSON)
- timestamp (DATETIME)

## Deployment

- Production: `https://es2.randall.codes`
- Auto-deploys via GitHub Actions on merge to `main`
- Process manager: pm2 (`es2-api`), redeployed through `$HOME/bin/pm2-keepalive.sh`
- Deployment workflow source: `.github/workflows/deploy.yml (19-30)`
- Production fallbacks are generated by `client/scripts/generate-spa-fallbacks.mjs (4-63)`
- The deploy action must fail on any failing step; keep `set -e` and the `git fetch --prune origin main` + `git reset --hard origin/main` pair so a diverged checkout cannot produce a green-but-stale deployment.

## Development Tips

- Use `tsx watch` for server hot reload (already configured)
- Client has Vite HMR for instant updates
- `client/vite.config.ts (7-29)` allows both the workspace path and native real path for dev file serving. Keep this when working from Windows paths that resolve through another drive.
- Database file is created automatically in `server/data/`
- Check browser console for client errors
- Check terminal for server logs
- API responses are logged in server console
- Use `buildActiveTimeline()` from `client/src/lib/activeTime.ts (26-79)` for historical pause-excluded durations and chart coordinates. The Live Monitor handles streaming pause/resume events separately.
- Add new configuration fields to the client `BaseConfig`, server Zod schema, and both return branches in `normalizeConfig()`. The create route persists Zod-parsed data and client normalization returns closed objects, so omitting either change silently strips unknown fields.
- Add new click telemetry fields to the explicit allow-list in `server/src/routes/sessions.ts (54-63)` or session reads will drop them.
- Timer callbacks that depend on current React state must use the established callback-ref pattern; auto-resume uses `resumeSessionRef` in `client/src/pages/Session.tsx (199-235)`.

## Troubleshooting

**Port already in use:**
```bash
# Kill process on port 3000 (server)
npx kill-port 3000

# Kill process on port 5173 (client)
npx kill-port 5173
```

**Database locked:**
- Close any SQLite browsers/tools
- Restart the server

**Import errors:**
- Check file paths (case-sensitive)
- Ensure .js extensions in server imports (ESM requirement)
- Run `npm run type-check` in respective workspace

## Building for Production

```bash
# Build both
npm run build

# Build client only
npm run build:client

# Build server only
npm run build:server

# Run production server
npm start
```

The production server serves the built client files.
