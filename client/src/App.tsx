import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Home } from './pages/Home';
import { ConfigurationSetup } from './pages/ConfigurationSetup';
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
                Easterseals Research
              </Link>
              <div className="flex gap-4">
                <Link
                  to="/"
                  className="text-sm font-medium hover:underline"
                >
                  Home
                </Link>
                <Link
                  to="/config/new"
                  className="text-sm font-medium hover:underline"
                >
                  New Configuration
                </Link>
              </div>
            </div>
          </div>
        </nav>

        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
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
