import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { Participant } from '../types';

export function Participants() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [archivedParticipants, setArchivedParticipants] = useState<Participant[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadParticipants();
  }, []);

  async function loadParticipants() {
    try {
      const [active, archived] = await Promise.all([
        api.getParticipants(),
        api.getParticipants({ archivedOnly: true }),
      ]);
      setParticipants(active);
      setArchivedParticipants(archived);
    } catch (error) {
      console.error('Failed to load participants:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleArchive(participantId: string) {
    try {
      await api.archiveParticipant(participantId);
      await loadParticipants();
    } catch (error) {
      console.error('Failed to archive participant:', error);
    }
  }

  async function handleUnarchive(participantId: string) {
    try {
      await api.unarchiveParticipant(participantId);
      await loadParticipants();
    } catch (error) {
      console.error('Failed to unarchive participant:', error);
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
        {archivedParticipants.length > 0 && (
          <Button 
            variant="outline" 
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? 'Hide' : 'Show'} Archived ({archivedParticipants.length})
          </Button>
        )}
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
                <div className="flex gap-2">
                  <Link to={`/analytics?participant=${participant.participantId}`} className="flex-1">
                    <Button className="w-full">View Analytics</Button>
                  </Link>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleArchive(participant.participantId)}
                    title="Archive participant"
                  >
                    Archive
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Archived Participants */}
      {showArchived && archivedParticipants.length > 0 && (
        <div className="border-t pt-6">
          <h2 className="text-xl font-semibold text-muted-foreground mb-4">Archived Participants</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {archivedParticipants.map((participant) => (
              <Card key={participant.participantId} className="opacity-60 hover:opacity-100 transition-opacity">
                <CardHeader>
                  <CardTitle className="text-2xl font-mono flex items-center gap-2">
                    {participant.participantId}
                    <span className="text-xs bg-muted px-2 py-0.5 rounded font-normal">Archived</span>
                  </CardTitle>
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
                  <div className="flex gap-2">
                    <Link to={`/analytics?participant=${participant.participantId}`} className="flex-1">
                      <Button variant="outline" className="w-full">View Analytics</Button>
                    </Link>
                    <Button 
                      variant="outline"
                      onClick={() => handleUnarchive(participant.participantId)}
                    >
                      Restore
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
