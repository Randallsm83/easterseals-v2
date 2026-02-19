import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { formatTimestamp } from '../lib/utils';
import type { SessionListItem } from '../types';

// Extract session number from composite sessionId (e.g., "100-3" -> "3")
function getSessionNumber(sessionId: string): string {
  const parts = sessionId.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : sessionId;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Home() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    try {
      const data = await api.getSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Quick Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sessions</h1>
          <p className="text-muted-foreground mt-1">All experiment sessions</p>
        </div>
        <div className="flex gap-3">
          <Link to="/configurations">
            <Button>Start Session</Button>
          </Link>
          <Link to="/config/new">
            <Button variant="outline">New Configuration</Button>
          </Link>
        </div>
      </div>

      {/* Sessions List */}
      {loading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Loading sessions...</p>
          </CardContent>
        </Card>
      ) : sessions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No sessions yet</CardTitle>
            <CardDescription>
              Create a configuration and start your first session to get started.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-4">
            <Link to="/config/new">
              <Button>Create Configuration</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 text-sm font-medium">Participant</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Session #</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Configuration</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Started</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Clicks</th>
                <th className="text-right px-4 py-3 text-sm font-medium">Money</th>
                <th className="text-center px-4 py-3 text-sm font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.sessionId} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium">{session.participantId}</td>
                  <td className="px-4 py-3 text-muted-foreground">#{getSessionNumber(session.sessionId)}</td>
                  <td className="px-4 py-3 text-sm">{session.configName}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {session.startedAt ? formatTimestamp(session.startedAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-mono">{session.totalClicks}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">
                    {session.finalMoney != null ? formatMoney(session.finalMoney) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      session.endedAt
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-primary/10 text-primary font-medium'
                    }`}>
                      {session.endedAt ? 'Completed' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/analytics/${session.sessionId}`}>
                      <Button variant="ghost" size="sm">View</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
