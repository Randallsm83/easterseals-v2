# Development Guide

## Project Status

### ✅ Completed
- Project structure setup with monorepo architecture
- Backend API with Express + TypeScript + Better-SQLite3
- Database schema with foreign key constraints and indexing
- Zod validation for all API inputs
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
- **Input color swatches** — 16-color preset palette for physical inputs

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
│   │   ├── lib/            # Utilities (API client, helpers)
│   │   ├── pages/          # Route pages
│   │   ├── stores/         # Zustand state management
│   │   ├── types/          # TypeScript interfaces
│   │   ├── App.tsx         # Main app with routing
│   │   └── main.tsx        # Entry point
│   ├── public/
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
- `GET /api/sessions/:sessionId/data` - Get full session data (config + events)
- `POST /api/sessions` - Create new session (returns session ID)
- `POST /api/sessions/:sessionId/start` - Start a created session
- `POST /api/sessions/:sessionId/end` - End a session
- `DELETE /api/sessions/:sessionId` - Delete session
- `GET /api/sessions/:sessionId/notes` - Get session notes
- `PUT /api/sessions/:sessionId/notes` - Save session notes
- `GET /api/sessions/:sessionId/stream` - SSE stream for live monitoring

### Events
- `POST /api/events` - Log a session event (start/click/end)
- `GET /api/events/:sessionId` - Get events for a session

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
- event (TEXT: 'start', 'click', 'end')
- value (TEXT, JSON)
- timestamp (DATETIME)

## Deployment

See `WARP.md` for deployment configuration.
- Production: `https://es2.randall.codes`
- Auto-deploys via GitHub Actions on merge to `main`
- Process manager: pm2 (`es2-api`)

## Development Tips

- Use `tsx watch` for server hot reload (already configured)
- Client has Vite HMR for instant updates
- Database file is created automatically in `server/data/`
- Check browser console for client errors
- Check terminal for server logs
- API responses are logged in server console

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
