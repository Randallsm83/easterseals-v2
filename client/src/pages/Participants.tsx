import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';

interface ParticipantSummary {
  participantId: string;
  sessionCount: number;
  lastSessionDate: string | null;
}

export function Participants() {
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadParticipants();
  }, []);

  async function loadParticipants() {
    try {
      const data = await api.getParticipants();
      setParticipants(data);
    } catch (error) {
      console.error('Failed to load participants:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Participants</h1>
          <p className="text-muted-foreground mt-1">
            View all participants and their session history
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Loading participants...</p>
          </CardContent>
        </Card>
      ) : participants.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">No participants yet. Start a session to create one!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {participants.map((participant) => (
            <Card key={participant.participantId} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle className="text-2xl font-mono">{participant.participantId}</CardTitle>
                <CardDescription>
                  {participant.sessionCount} session{participant.sessionCount !== 1 ? 's' : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {participant.lastSessionDate && (
                  <p className="text-sm text-muted-foreground mb-4">
                    Last session: {new Date(participant.lastSessionDate).toLocaleDateString()}
                  </p>
                )}
                <Link to={`/analytics?participant=${participant.participantId}`}>
                  <Button className="w-full">View Analytics</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
