import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { formatSessionStatus, formatTimestamp } from '../lib/utils';
import type { SequenceRun } from '../types';

export function SequenceRunDetail() {
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId') || '';
  return <RunDetail key={runId} runId={runId} />;
}

function RunDetail({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const [run, setRun] = useState<SequenceRun | null>(null);
  const [loading, setLoading] = useState(Boolean(runId));
  const [error, setError] = useState<string | null>(runId ? null : 'Missing sequence run ID.');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    api.getSequenceRun(runId)
      .then(data => {
        if (!cancelled) setRun(data);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load sequence run.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [runId]);

  function toggleSession(sessionId: string) {
    setSelectedIds(current => {
      if (current.includes(sessionId)) return current.filter(id => id !== sessionId);
      return current.length < 5 ? [...current, sessionId] : current;
    });
  }

  function compareSelected() {
    if (!run || selectedIds.length < 2) return;
    const params = new URLSearchParams({ participantId: run.participantId });
    for (const entry of run.entries) {
      if (entry.startedAt !== null && selectedIds.includes(entry.sessionId)) params.append('sessionId', entry.sessionId);
    }
    navigate(`/compare?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <Link to="/sequence-history" className="text-primary underline underline-offset-4">Back to Sequence Runs</Link>
      {loading ? (
        <p className="text-muted-foreground">Loading sequence run...</p>
      ) : error ? (
        <div>
          <h1 className="text-3xl font-bold mb-4">Sequence Run</h1>
          <p role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
            Could not load sequence run: {error}
          </p>
        </div>
      ) : run && (
        <>
          <div>
            <h1 className="text-3xl font-bold">{run.sequenceName}</h1>
            <p className="text-muted-foreground mt-1">Recorded run with conditions frozen at launch.</p>
          </div>
          <Card>
            <CardContent className="p-6">
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <div><dt className="text-muted-foreground">Run ID</dt><dd className="font-mono break-all">{run.runId}</dd></div>
                <div><dt className="text-muted-foreground">Original sequence ID</dt><dd className="font-mono break-all">{run.sequenceId}</dd></div>
                <div><dt className="text-muted-foreground">Participant ID</dt><dd className="font-mono">{run.participantId}</dd></div>
                <div><dt className="text-muted-foreground">Status</dt><dd>{{ running: 'Running', completed: 'Completed', interrupted: 'Interrupted' }[run.status]}</dd></div>
                <div><dt className="text-muted-foreground">Created</dt><dd>{formatTimestamp(run.createdAt)}</dd></div>
                <div><dt className="text-muted-foreground">Ended</dt><dd>{run.endedAt ? formatTimestamp(run.endedAt) : '—'}</dd></div>
              </dl>
            </CardContent>
          </Card>
          {run.status === 'interrupted' && (
            <p className="text-sm text-muted-foreground">
              Interrupted sessions retain only saved partial results, without a completed ending. Planned sessions never started.
            </p>
          )}
          {run.status === 'running' && (
            <p className="text-sm text-muted-foreground">
              Running is the last saved status. Viewing history does not resume or interrupt participation.
            </p>
          )}
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="text-xl font-semibold">Run sessions</h2>
              <p id="run-comparison-help" className="text-sm text-muted-foreground">
                Select 2 to 5 started sessions to compare their individual results. Planned sessions have no participation data.
              </p>
              <div role="region" aria-label="Ordered run sessions" tabIndex={0} className="overflow-x-auto">
                <table aria-label="Run sessions" className="w-full min-w-[700px] text-sm text-left">
                  <thead className="border-b">
                    <tr>
                      <th scope="col" className="p-3">Position</th>
                      <th scope="col" className="p-3">Condition</th>
                      <th scope="col" className="p-3">Session</th>
                      <th scope="col" className="p-3">Status</th>
                      <th scope="col" className="p-3">Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.entries.map(entry => {
                      const started = entry.startedAt !== null;
                      const sequenceStatus = entry.endedAt !== null ? 'completed' : !started ? 'planned' : run.status === 'interrupted' ? 'interrupted' : 'active';
                      const selected = selectedIds.includes(entry.sessionId);
                      return (
                        <tr key={entry.sessionId} className="border-b last:border-0">
                          <th scope="row" className="p-3 font-normal">{entry.position + 1}</th>
                          <td className="p-3">
                            <div className="font-medium">{entry.configName}</div>
                            <div className="font-mono text-xs text-muted-foreground">{entry.configId}</div>
                          </td>
                          <td className="p-3">
                            <div className="font-mono">{entry.sessionId}</div>
                            <div className="text-xs text-muted-foreground">Started: {entry.startedAt ? formatTimestamp(entry.startedAt) : 'Not started'}</div>
                            <div className="text-xs text-muted-foreground">Ended: {entry.endedAt ? formatTimestamp(entry.endedAt) : '—'}</div>
                          </td>
                          <td className="p-3">{formatSessionStatus({ sequenceStatus, endedAt: entry.endedAt })}</td>
                          <td className="p-3">
                            {started ? (
                              <div className="flex flex-wrap items-center gap-3">
                                <Link to={`/analytics/${encodeURIComponent(entry.sessionId)}`} aria-label={`Analytics for ${entry.sessionId}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">
                                  Analytics
                                </Link>
                                <label htmlFor={`compare-run-session-${entry.position}`} className="inline-flex min-h-11 items-center gap-2 px-2">
                                  <input
                                    id={`compare-run-session-${entry.position}`}
                                    type="checkbox"
                                    checked={selected}
                                    disabled={!selected && selectedIds.length >= 5}
                                    onChange={() => toggleSession(entry.sessionId)}
                                    aria-describedby="run-comparison-help"
                                    className="h-4 w-4 rounded border-border"
                                  />
                                  Compare<span className="sr-only"> {entry.sessionId}</span>
                                </label>
                              </div>
                            ) : <span className="text-muted-foreground">Not started</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" disabled={selectedIds.length < 2} onClick={compareSelected}>
                  Compare selected sessions
                </Button>
                <p role="status" className="text-sm text-muted-foreground">{selectedIds.length} / 5 selected</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
