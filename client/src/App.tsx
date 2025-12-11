import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Home } from './pages/Home';
import { ConfigurationSetup } from './pages/ConfigurationSetup';
import { Configurations } from './pages/Configurations';
import { Participants } from './pages/Participants';
import { StartSession } from './pages/StartSession';
import { Session } from './pages/Session';
import { Analytics } from './pages/Analytics';

function App() {
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
              </div>
            </div>
          </div>
        </nav>

        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/participants" element={<Participants />} />
            <Route path="/configurations" element={<Configurations />} />
            <Route path="/config/new" element={<ConfigurationSetup />} />
            <Route path="/start/:configId" element={<StartSession />} />
            <Route path="/session/:sessionId" element={<Session />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analytics/:sessionId" element={<Analytics />} />
            <Route path="/config/:configId/sessions" element={<Analytics />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
