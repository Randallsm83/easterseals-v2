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
- Zustand state management
- API client with type-safe methods
- Base UI components (Button, Card, Input, Label)
- **Dark theme as default** with comfortable color palette
- Home page with session list and statistics
- **Session Setup Form** with full button configuration
- **Active Session Page** with clickable styled buttons
- **Analytics Dashboard** with Recharts visualizations
- Click tracking and event logging
- Session timer/limit enforcement
- Data export (CSV)
- All core features implemented and functional

### 🎯 Optional Enhancements
The following features could be added in the future:

1. **Light/Dark Mode Toggle** - User-selectable theme switcher
2. **Enhanced Animations** - Button click animations, point popup effects
3. **Session Comparison** - Side-by-side comparison of multiple sessions
4. **Real-time Monitoring** - Live view of active sessions
5. **Session Templates** - Save and reuse session configurations
6. **Advanced Analytics** - Heat maps, trend analysis, statistical tests
7. **Export Options** - PDF reports, JSON export
8. **Session Notes** - Add notes/observations to sessions

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
- `GET /api/sessions/:sessionId/config` - Get session configuration
- `GET /api/sessions/:sessionId/data` - Get full session data (config + events)
- `POST /api/sessions` - Create new session
- `DELETE /api/sessions/:sessionId` - Delete session

### Events
- `POST /api/events` - Log a session event (start/click/end)
- `GET /api/events/:sessionId` - Get events for a session

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

## Next Steps

1. **Implement Session Setup Form**
   - Create form fields for all session config options
   - Add color picker inputs
   - Add shape selector (dropdown or radio buttons)
   - Validate inputs before submission
   - Handle API errors gracefully

2. **Build Active Session Interface**
   - Render three buttons with custom styles
   - Track clicks in Zustand store
   - Send click events to API
   - Display large point counter
   - Handle session end (time or points limit)
   - Show "session ended" message

3. **Create Analytics Visualizations**
   - Fetch session data from API
   - Transform data for Recharts
   - Create charts:
     - Scatter plot: clicks over time by button
     - Line chart: cumulative points
     - Bar chart: click distribution
   - Add filtering/date range selection
   - Implement CSV export

4. **Polish & Features**
   - Add loading states
   - Error boundaries
   - Toast notifications
   - Dark mode implementation
   - Button click animations
   - Session comparison view

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
