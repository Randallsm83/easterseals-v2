import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import type { Configuration, RawStoredConfig } from '../types';
import { normalizeConfig } from '../lib/normalizeConfig';

export function StartSession() {
  const { configId } = useParams<{ configId: string }>();
  const navigate = useNavigate();
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [participantId, setParticipantId] = useState('');
  const [nextSessionId, setNextSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (configId) {
      loadConfiguration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId]);

  // Fetch next session ID when participant ID changes
  useEffect(() => {
    if (participantId.trim()) {
      loadNextSessionId(participantId);
    } else {
      setNextSessionId(null);
    }
  }, [participantId]);

  async function loadConfiguration() {
    try {
      const data = await api.getConfiguration(configId!);
      setConfiguration(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }

  async function loadNextSessionId(pid: string) {
    try {
      const result = await api.getNextSessionId(pid);
      setNextSessionId(result.nextSessionId);
    } catch {
      setNextSessionId('1');
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await api.startSession({ participantId, configId: configId! });
      // Server returns the auto-generated sessionId (format: participantId-sequenceNumber)
      navigate(`/session/${result.sessionId}`);
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
          <CardDescription>Enter participant ID to begin</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleStart} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="participantId">Participant ID *</Label>
              <Input
                id="participantId"
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
                placeholder="e.g., 150"
                required
              />
              {participantId.trim() && nextSessionId && (
                <p className="text-sm text-primary">
                  This will be session #{nextSessionId} for participant {participantId}
                </p>
              )}
            </div>

            {(() => {
              const normalized = normalizeConfig(config as RawStoredConfig);
              const rewardedInputs = normalized.inputs.filter(i => i.isRewarded);
              return (
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="font-medium">Configuration Summary:</h3>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Time Limit:</span>
                      <span>{normalized.timeLimit} seconds</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inputs:</span>
                      <span>
                        {normalized.inputs.filter(i => i.type === 'screen').length} screen,{' '}
                        {normalized.inputs.filter(i => i.type !== 'screen').length} physical
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rewarded:</span>
                      <span>
                        {rewardedInputs.length > 0
                          ? rewardedInputs.map(i => i.name || 'Unnamed').join(', ')
                          : 'None'}
                      </span>
                    </div>
                    {rewardedInputs.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Award:</span>
                        <span>${(rewardedInputs[0].moneyAwarded / 100).toFixed(2)} per {rewardedInputs[0].awardInterval} clicks</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Money Limit:</span>
                      <span>${(normalized.moneyLimit / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Starting Money:</span>
                      <span>${(normalized.startingMoney / 100).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

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
