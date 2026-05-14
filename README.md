# Easterseals Research Study v2

A modern behavioral research tracking application for studying button-click patterns and reward systems.

## Features

- 🎯 **Session Configuration**: Customizable buttons, rewards, and session limits
- 📊 **Enhanced Visualizations**: Interactive charts with real-time updates
- 🔄 **Live Monitoring**: Watch sessions as they happen
- 📈 **Analytics Dashboard**: Aggregate statistics across sessions, with end-reason indicator
- 📤 **Data Export**: Export to CSV/JSON for external analysis
- ⏸️ **Periodic Pauses**: Configurable mid-session pauses with auto- or manual-resume
- 🙈 **Participant Display Control**: Optionally hide the money counter from the participant
- 🌓 **Dark Mode**: Built-in theme support
- 📱 **Responsive**: Mobile-first design

## Tech Stack

### Frontend
- React 18 + TypeScript
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

1. **Setup Session**: Configure session parameters, button styles, and reward system
2. **Run Session**: Participants click buttons to earn points
3. **View Analytics**: Analyze click patterns and performance metrics
4. **Export Data**: Download session data for further analysis

## License

ISC
