import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { api } from '../lib/api';
import { formatTimestamp } from '../lib/utils';
import type { SequenceRun } from '../types';

export function SequenceRunHistory() {
  const [runs, setRuns] = useState<Omit<SequenceRun, 'entries'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getSequenceRuns()
      .then(data => {
        if (!cancelled) setRuns(data);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load sequence runs.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Sequence Runs</h1>
        <p className="text-muted-foreground mt-1">
          Inspect recorded runs and their frozen session order without starting or resuming participation.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          Could not load sequence runs: {error}
        </p>
      )}
      <Card>
        <CardContent className="p-6">
          {loading ? (
            <p className="text-muted-foreground">Loading sequence runs...</p>
          ) : !error && runs.length === 0 ? (
            <p className="text-muted-foreground">No sequence runs yet.</p>
          ) : !error && (
            <div role="region" aria-label="Sequence run history" tabIndex={0} className="overflow-x-auto">
              <table aria-label="Sequence runs" className="w-full min-w-[800px] text-sm text-left">
                <thead className="border-b">
                  <tr>
                    <th scope="col" className="p-3">Run</th>
                    <th scope="col" className="p-3">Sequence</th>
                    <th scope="col" className="p-3">Participant</th>
                    <th scope="col" className="p-3">Status</th>
                    <th scope="col" className="p-3">Created</th>
                    <th scope="col" className="p-3">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.runId} className="border-b last:border-0">
                      <th scope="row" className="p-3 font-mono font-normal">
                        <Link to={`/sequence-history/run?runId=${encodeURIComponent(run.runId)}`} className="text-primary underline underline-offset-4">
                          {run.runId}
                        </Link>
                      </th>
                      <td className="p-3">
                        <div className="font-medium">{run.sequenceName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{run.sequenceId}</div>
                      </td>
                      <td className="p-3 font-mono">{run.participantId}</td>
                      <td className="p-3">{{ running: 'Running', completed: 'Completed', interrupted: 'Interrupted' }[run.status]}</td>
                      <td className="p-3 whitespace-nowrap">{formatTimestamp(run.createdAt)}</td>
                      <td className="p-3 whitespace-nowrap">{run.endedAt ? formatTimestamp(run.endedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
