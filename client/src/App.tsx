import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Home } from './pages/Home';
import { ConfigurationSetup } from './pages/ConfigurationSetup';
import { Configurations } from './pages/Configurations';
import { Participants } from './pages/Participants';
import { StartSession } from './pages/StartSession';
import { Session } from './pages/Session';
import { Analytics } from './pages/Analytics';
import { LiveSession } from './pages/LiveSession';
import { SessionComparison } from './pages/SessionComparison';
import { useTheme } from './lib/useTheme';

function App() {
  const { theme, toggleTheme } = useTheme();
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background">
        <nav className="border-b">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <Link to="/" className="text-2xl font-bold">
                Research Platform
              </Link>
              <div className="flex gap-6">
                <Link
                  to="/"
                  className="text-sm font-medium hover:underline"
                >
                  Home
                </Link>
                <Link
                  to="/participants"
                  className="text-sm font-medium hover:underline"
                >
                  Participants
                </Link>
                <Link
                  to="/configurations"
                  className="text-sm font-medium hover:underline"
                >
                  Configurations
                </Link>
                <Link
                  to="/analytics"
                  className="text-sm font-medium hover:underline"
                >
                  Analytics
                </Link>
                <Link
                  to="/compare"
                  className="text-sm font-medium hover:underline"
                >
                  Compare
                </Link>
                <Link
                  to="/monitor"
                  className="text-sm font-medium hover:underline"
                >
                  Monitor
                </Link>
              </div>
              <button
                onClick={toggleTheme}
                className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {theme === 'dark' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </nav>

        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/participants" element={<Participants />} />
            <Route path="/configurations" element={<Configurations />} />
            <Route path="/config/new" element={<ConfigurationSetup />} />
            <Route path="/config/:configId/edit" element={<ConfigurationSetup />} />
            <Route path="/start/:configId" element={<StartSession />} />
            <Route path="/session/:sessionId" element={<Session />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analytics/:sessionId" element={<Analytics />} />
            <Route path="/config/:configId/sessions" element={<Analytics />} />
            <Route path="/monitor" element={<LiveSession />} />
            <Route path="/monitor/:sessionId" element={<LiveSession />} />
            <Route path="/compare" element={<SessionComparison />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
