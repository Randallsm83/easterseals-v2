import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import type { Configuration } from '../types';

export function StartSession() {
  const { configId } = useParams<{ configId: string }>();
  const navigate = useNavigate();
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (configId) {
      loadConfiguration();
    }
  }, [configId]);

  async function loadConfiguration() {
    try {
      const data = await api.getConfiguration(configId!);
      setConfiguration(data);
      // Generate a default session ID
      setSessionId(`${data.configId}-${Date.now()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.startSession({ sessionId, configId: configId! });
      navigate(`/session/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading configuration...</p>
      </div>
    );
  }

  if (!configuration) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <p className="text-destructive">{error || 'Configuration not found'}</p>
        <Button onClick={() => navigate('/')}>Return to Home</Button>
      </div>
    );
  }

  const config = typeof configuration.config === 'string' ? JSON.parse(configuration.config) : configuration.config;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Start New Session</h1>
        <p className="text-muted-foreground mt-2">
          Using configuration: <span className="font-medium">{configuration.name}</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session Details</CardTitle>
          <CardDescription>Enter a unique session ID to begin</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleStart} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="sessionId">Session ID *</Label>
              <Input
                id="sessionId"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="session-123"
                required
              />
              <p className="text-xs text-muted-foreground">
                This identifies this specific run of the configuration
              </p>
            </div>

            <div className="space-y-3 pt-4 border-t">
              <h3 className="font-medium">Configuration Summary:</h3>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Button:</span>
                  <span className="capitalize">{config.buttonActive}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Points Awarded:</span>
                  <span>{config.pointsAwarded} per {config.clicksNeeded} clicks</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Session Limit:</span>
                  <span>{config.sessionLength} {config.sessionLengthType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Starting Points:</span>
                  <span>{config.startingPoints}</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex gap-4">
              <Button type="submit" size="lg" disabled={submitting} className="flex-1">
                {submitting ? 'Starting...' : 'Start Session'}
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={() => navigate('/')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
