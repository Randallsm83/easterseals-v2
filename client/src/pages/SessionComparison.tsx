import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { Participant, SessionListItem, SessionDataResponse, RawStoredConfig } from '../types';
import { normalizeConfig } from '../lib/normalizeConfig';
import { parseSqliteDate, formatTimestamp, formatDuration } from '../lib/utils';

const COMPARISON_PALETTE = [
  '#5ccc96', '#e39400', '#00a3cc', '#b3a1e6', '#ce6f8f', '#42b3c2', '#f2ce00',
];

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface SessionSummary {
  sessionId: string;
  color: string;
  data: SessionDataResponse;
  stats: {
    duration: number;
    totalClicks: number;
    correctClicks: number;
    accuracy: number;
    finalMoney: number;
    clickRate: number;
  };
  // Cumulative money over time: array of { t: seconds, money: cents }
  moneyTimeline: { t: number; money: number }[];
  // Cumulative total clicks over time
  clickTimeline: { t: number; clicks: number }[];
}

export function SessionComparison() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadedSessions, setLoadedSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [participantFilter, setParticipantFilter] = useState('');

  useEffect(() => {
    api.getParticipants().then(setParticipants).catch(console.error);
  }, []);

  useEffect(() => {
    async function load() {
      let data: SessionListItem[];
      if (participantFilter) {
        data = await api.getParticipantSessions(participantFilter);
      } else {
        // getSessions returns all sessions
        data = (await api.getSessions()).slice(0, 100); // cap at 100
      }
      setSessions(data);
    }
    load().catch(console.error);
  }, [participantFilter]);

  function toggleSession(sessionId: string) {
    setSelectedIds((prev) => {
      if (prev.includes(sessionId)) return prev.filter((id) => id !== sessionId);
      if (prev.length >= 5) return prev; // max 5 sessions
      return [...prev, sessionId];
    });
  }

  async function handleCompare() {
    if (selectedIds.length < 2) return;
    setLoading(true);
    try {
      const results = await Promise.all(selectedIds.map((id) => api.getSessionData(id)));
      const summaries: SessionSummary[] = results.map((data, i) => {
        const sessionId = selectedIds[i];
        const color = COMPARISON_PALETTE[i % COMPARISON_PALETTE.length];
        const rawCfg = data.sessionConfig as unknown as RawStoredConfig;
        const normalizedCfg = normalizeConfig(rawCfg);
        const rewardedIds = new Set(normalizedCfg.inputs.filter(inp => inp.isRewarded).map(inp => inp.id));

        if (!data.startEvent) {
          return {
            sessionId, color, data,
            stats: { duration: 0, totalClicks: 0, correctClicks: 0, accuracy: 0, finalMoney: 0, clickRate: 0 },
            moneyTimeline: [], clickTimeline: [],
          };
        }

        const startTime = parseSqliteDate(data.startEvent.timestamp).getTime();
        let endTime: number;
        if (data.endEvent) {
          endTime = parseSqliteDate(data.endEvent.timestamp).getTime();
        } else if (data.allClicks.length > 0) {
          endTime = parseSqliteDate(data.allClicks[data.allClicks.length - 1].timestamp).getTime();
        } else {
          endTime = startTime;
        }

        const duration = (endTime - startTime) / 1000;
        const totalClicks = data.allClicks.length;
        const correctClicks = data.allClicks.filter((c) => {
          const raw = c as unknown as Record<string, unknown>;
          return rewardedIds.has((raw.inputId ?? c.buttonClicked) as string);
        }).length;
        const accuracy = totalClicks > 0 ? Math.round((correctClicks / totalClicks) * 100) : 0;
        const clickRate = duration > 0 ? Math.round((totalClicks / duration) * 100) / 100 : 0;

        let finalMoney: number = data.startEvent?.value?.moneyCounter ?? 0;
        if (data.endEvent?.value?.moneyCounter !== undefined) {
          finalMoney = data.endEvent.value.moneyCounter;
        }

        // Build timelines
        const moneyTimeline: { t: number; money: number }[] = [];
        const clickTimeline: { t: number; clicks: number }[] = [];
        let cumClicks = 0;
        let cumMoney: number = normalizedCfg.startingMoney ?? 0;

        for (const click of data.allClicks) {
          const t = (parseSqliteDate(click.timestamp).getTime() - startTime) / 1000;
          cumClicks++;
          const rawClick = click as unknown as Record<string, unknown>;
          if (rawClick.sessionInfo && typeof rawClick.sessionInfo === 'object') {
            const si = rawClick.sessionInfo as { moneyCounter?: number };
            if (si.moneyCounter !== undefined) cumMoney = si.moneyCounter;
          } else if (click.sessionInfo?.moneyCounter !== undefined) {
            cumMoney = click.sessionInfo.moneyCounter;
          }
          moneyTimeline.push({ t: Math.round(t * 10) / 10, money: cumMoney });
          clickTimeline.push({ t: Math.round(t * 10) / 10, clicks: cumClicks });
        }

        return {
          sessionId, color, data,
          stats: { duration, totalClicks, correctClicks, accuracy, finalMoney, clickRate },
          moneyTimeline,
          clickTimeline,
        };
      });
      setLoadedSessions(summaries);
    } catch (err) {
      console.error('Failed to load session data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Normalize timelines to a common x-axis (time buckets every 5s)
  const normalizedMoneyData = useMemo(() => {
    if (!loadedSessions.length) return [];
    const maxT = Math.max(...loadedSessions.map(s => s.moneyTimeline[s.moneyTimeline.length - 1]?.t ?? 0));
    if (maxT === 0) return [];

    const points: Record<number, Record<string, number>> = {};
    for (const session of loadedSessions) {
      let lastMoney = session.data.startEvent?.value?.moneyCounter ?? 0;
      for (let t = 0; t <= maxT; t += 5) {
        // find last money value at or before t
        const pointsAtT = session.moneyTimeline.filter(p => p.t <= t);
        if (pointsAtT.length > 0) {
          lastMoney = pointsAtT[pointsAtT.length - 1].money;
        }
        if (!points[t]) points[t] = { t };
        points[t][session.sessionId] = lastMoney;
      }
    }
    return Object.values(points).sort((a, b) => (a.t as number) - (b.t as number));
  }, [loadedSessions]);

  const normalizedClickData = useMemo(() => {
    if (!loadedSessions.length) return [];
    const maxT = Math.max(...loadedSessions.map(s => s.clickTimeline[s.clickTimeline.length - 1]?.t ?? 0));
    if (maxT === 0) return [];

    const points: Record<number, Record<string, number>> = {};
    for (const session of loadedSessions) {
      let lastClicks = 0;
      for (let t = 0; t <= maxT; t += 5) {
        const pointsAtT = session.clickTimeline.filter(p => p.t <= t);
        if (pointsAtT.length > 0) lastClicks = pointsAtT[pointsAtT.length - 1].clicks;
        if (!points[t]) points[t] = { t };
        points[t][session.sessionId] = lastClicks;
      }
    }
    return Object.values(points).sort((a, b) => (a.t as number) - (b.t as number));
  }, [loadedSessions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Session Comparison</h1>
        <p className="text-muted-foreground mt-2">Compare up to 5 sessions side by side</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Sessions</CardTitle>
          <CardDescription>
            {selectedIds.length} / 5 selected
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Filter by Participant</label>
            <select
              value={participantFilter}
              onChange={(e) => setParticipantFilter(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">All participants</option>
              {participants.map((p) => (
                <option key={p.participantId} value={p.participantId}>
                  {p.participantId} ({p.sessionCount} sessions)
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-border overflow-hidden max-h-64 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="text-muted-foreground text-sm p-4">No sessions found</p>
            ) : (
              sessions.map((session) => {
                const selected = selectedIds.includes(session.sessionId);
                const idx = selectedIds.indexOf(session.sessionId);
                const color = idx >= 0 ? COMPARISON_PALETTE[idx % COMPARISON_PALETTE.length] : undefined;
                return (
                  <label
                    key={session.sessionId}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer border-b border-border/50 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSession(session.sessionId)}
                      disabled={!selected && selectedIds.length >= 5}
                      className="h-4 w-4 rounded border-border shrink-0"
                    />
                    {color && (
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    )}
                    <span className="font-mono text-sm flex-1">{session.sessionId}</span>
                    <span className="text-xs text-muted-foreground">
                      {session.startedAt ? formatTimestamp(session.startedAt) : '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {session.totalClicks} clicks
                    </span>
                    {session.finalMoney !== null && (
                      <span className="text-xs text-muted-foreground">
                        {formatMoney(session.finalMoney)}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleCompare}
              disabled={selectedIds.length < 2 || loading}
            >
              {loading ? 'Loading...' : `Compare ${selectedIds.length} Session${selectedIds.length !== 1 ? 's' : ''}`}
            </Button>
            {selectedIds.length > 0 && (
              <Button variant="outline" onClick={() => { setSelectedIds([]); setLoadedSessions([]); }}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loadedSessions.length >= 2 && (
        <>
          {/* Stats comparison table */}
          <Card>
            <CardHeader>
              <CardTitle>Stats Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  {/* Header row */}
                  <div className="grid gap-1 mb-2" style={{ gridTemplateColumns: `160px repeat(${loadedSessions.length}, 1fr)` }}>
                    <div className="text-xs font-semibold text-muted-foreground uppercase py-2"></div>
                    {loadedSessions.map((s) => (
                      <div key={s.sessionId} className="text-center py-2">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                          <Link to={`/analytics/${s.sessionId}`} className="font-mono text-xs hover:underline">{s.sessionId}</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Stat rows */}
                  {[
                    { label: 'Duration', fn: (s: SessionSummary) => formatDuration(s.stats.duration) },
                    { label: 'Total Clicks', fn: (s: SessionSummary) => s.stats.totalClicks.toString() },
                    { label: 'Correct Clicks', fn: (s: SessionSummary) => s.stats.correctClicks.toString() },
                    { label: 'Accuracy', fn: (s: SessionSummary) => `${s.stats.accuracy}%` },
                    { label: 'Click Rate', fn: (s: SessionSummary) => `${s.stats.clickRate}/s` },
                    { label: 'Money Earned', fn: (s: SessionSummary) => formatMoney(s.stats.finalMoney) },
                  ].map(({ label, fn }, rowIdx) => (
                    <div
                      key={label}
                      className={`grid gap-1 rounded-md ${rowIdx % 2 === 0 ? 'bg-muted/20' : ''}`}
                      style={{ gridTemplateColumns: `160px repeat(${loadedSessions.length}, 1fr)` }}
                    >
                      <div className="text-sm text-muted-foreground px-2 py-2">{label}</div>
                      {loadedSessions.map((s) => (
                        <div key={s.sessionId} className="text-center text-sm font-semibold py-2">{fn(s)}</div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Money accumulation comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Money Accumulation Over Time</CardTitle>
              <CardDescription>
                Cumulative earnings (5-second buckets)
                <span className="ml-4 inline-flex flex-wrap gap-3">
                  {loadedSessions.map(s => (
                    <span key={s.sessionId} className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="font-mono text-xs">{s.sessionId}</span>
                    </span>
                  ))}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={normalizedMoneyData} margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis dataKey="t" type="number"
                    domain={['dataMin', 'dataMax']}
                    stroke="#888" tick={{ fill: '#888' }}
                    label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                  />
                  <YAxis stroke="#888" tick={{ fill: '#888' }}
                    tickFormatter={(v: number) => `$${(v / 100).toFixed(2)}`}
                    label={{ value: 'Money', angle: -90, position: 'insideLeft', offset: -15, fill: '#888' }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: number) => [formatMoney(value), '']}
                    labelFormatter={(value: number) => `Time: ${value}s`}
                  />
                  <Legend verticalAlign="top" iconType="line" wrapperStyle={{ paddingBottom: 10 }} />
                  {loadedSessions.map(s => (
                    <Line
                      key={s.sessionId}
                      type="stepAfter"
                      dataKey={s.sessionId}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      name={s.sessionId}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Click accumulation comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Click Accumulation Over Time</CardTitle>
              <CardDescription>
                Cumulative clicks (5-second buckets)
                <span className="ml-4 inline-flex flex-wrap gap-3">
                  {loadedSessions.map(s => (
                    <span key={s.sessionId} className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="font-mono text-xs">{s.sessionId}</span>
                    </span>
                  ))}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={normalizedClickData} margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis dataKey="t" type="number"
                    domain={['dataMin', 'dataMax']}
                    stroke="#888" tick={{ fill: '#888' }}
                    label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                  />
                  <YAxis stroke="#888" tick={{ fill: '#888' }}
                    label={{ value: 'Total Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: number, name: string) => [value, name]}
                    labelFormatter={(value: number) => `Time: ${value}s`}
                  />
                  <Legend verticalAlign="top" iconType="line" wrapperStyle={{ paddingBottom: 10 }} />
                  {loadedSessions.map(s => (
                    <Line
                      key={s.sessionId}
                      type="monotone"
                      dataKey={s.sessionId}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      name={s.sessionId}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      {loadedSessions.length === 1 && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Select at least 2 sessions to compare.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
