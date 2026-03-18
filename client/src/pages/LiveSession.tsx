import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Input } from '../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { RawStoredConfig } from '../types';
import { normalizeConfig } from '../lib/normalizeConfig';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

interface ClickEntry {
  timestamp: string;
  inputId: string;
  inputLabel?: string;
  moneyCounter: number;
  awardedCents: number;
}

interface Snapshot {
  hasStarted: boolean;
  hasEnded: boolean;
  clickCount: number;
  startTimestamp: string | null;
  endTimestamp: string | null;
  startData: { moneyCounter?: number } | null;
  endData: { moneyCounter?: number; finalMoney?: number } | null;
}

export function LiveSession() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const [inputId, setInputId] = useState('');
  const [connected, setConnected] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [totalClicks, setTotalClicks] = useState(0);
  const [moneyCounter, setMoneyCounter] = useState(0);
  const [lastClick, setLastClick] = useState<ClickEntry | null>(null);
  const [recentClicks, setRecentClicks] = useState<ClickEntry[]>([]);
  const [startTimestamp, setStartTimestamp] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [inputConfig, setInputConfig] = useState<Record<string, { name: string; color?: string; type: string; inputLabel?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load session config for input name/color lookup
  useEffect(() => {
    if (!sessionId) return;
    api.getSessionData(sessionId)
      .then((data) => {
        const rawCfg = data.sessionConfig as unknown as RawStoredConfig;
        const normalized = normalizeConfig(rawCfg);
        const inputMap: Record<string, { name: string; color?: string; type: string; inputLabel?: string }> = {};
        for (const input of normalized.inputs) {
          inputMap[input.id] = {
            name: input.name || 'Unnamed',
            color: input.type === 'screen' ? input.color : undefined,
            type: input.type,
            inputLabel: input.inputLabel,
          };
        }
        setInputConfig(inputMap);
      })
      .catch(() => {});
  }, [sessionId]);

  // Connect to SSE stream
  useEffect(() => {
    if (!sessionId) return;

    const url = `${API_BASE_URL}/sessions/${sessionId}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onerror = () => {
      setConnected(false);
      setError('Connection lost. Refresh to reconnect.');
    };

    es.onmessage = (e) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(e.data as string);
      } catch {
        return;
      }

      const type = parsed.type as string;

      if (type === 'connected') {
        setConnected(true);
        const snap = parsed.snapshot as Snapshot;
        setSnapshot(snap);
        setTotalClicks(snap.clickCount);
        if (snap.startTimestamp) setStartTimestamp(snap.startTimestamp);
        if (snap.hasEnded) {
          setSessionEnded(true);
          const finalMoney = snap.endData?.finalMoney ?? snap.endData?.moneyCounter ?? snap.startData?.moneyCounter ?? 0;
          setMoneyCounter(finalMoney);
        } else if (snap.startData?.moneyCounter !== undefined) {
          setMoneyCounter(snap.startData.moneyCounter);
        }
      }

      if (type === 'start') {
        const data = parsed.data as Record<string, unknown>;
        const ts = parsed.timestamp as string;
        setStartTimestamp(ts);
        setMoneyCounter((data.moneyCounter as number) ?? 0);
      }

      if (type === 'click') {
        const data = parsed.data as Record<string, unknown>;
        const ts = parsed.timestamp as string;
        const inputId = (data.inputId ?? data.buttonClicked ?? 'unknown') as string;
        const money = (data.moneyCounter ?? 0) as number;
        const awarded = (data.awardedCents ?? 0) as number;
        const entry: ClickEntry = {
          timestamp: ts,
          inputId,
          moneyCounter: money,
          awardedCents: awarded,
        };
        setTotalClicks((prev) => prev + 1);
        setMoneyCounter(money);
        setLastClick(entry);
        setRecentClicks((prev) => [entry, ...prev].slice(0, 20));
      }

      if (type === 'end') {
        const data = parsed.data as Record<string, unknown>;
        const finalMoney = (data.moneyCounter ?? data.finalMoney ?? moneyCounter) as number;
        setMoneyCounter(finalMoney);
        setSessionEnded(true);
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Elapsed time timer
  useEffect(() => {
    if (!startTimestamp || sessionEnded) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    const start = new Date(startTimestamp).getTime();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startTimestamp, sessionEnded]);

  function formatElapsed(sec: number) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatMoney(cents: number) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function formatTs(ts: string) {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  const getInputDisplay = (inputId: string) => {
    const cfg = inputConfig[inputId];
    return cfg ? { name: cfg.name, color: cfg.color, label: cfg.inputLabel ?? cfg.type } : { name: inputId, color: undefined, label: '' };
  };

  if (!sessionId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Live Monitor</h1>
          <p className="text-muted-foreground mt-2">Enter the session ID to connect</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = inputId.trim();
            if (id) navigate(`/monitor/${id}`);
          }}
          className="flex gap-2 w-full max-w-sm"
        >
          <Input
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="e.g. participant1-3"
            autoFocus
            className="font-mono"
          />
          <Button type="submit" disabled={!inputId.trim()}>Connect</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Live Monitor</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{sessionId}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full ${
            sessionEnded
              ? 'bg-muted text-muted-foreground'
              : connected
              ? 'bg-primary/10 text-primary'
              : 'bg-destructive/10 text-destructive'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              sessionEnded ? 'bg-muted-foreground' : connected ? 'bg-primary animate-pulse' : 'bg-destructive'
            }`} />
            {sessionEnded ? 'Session Ended' : connected ? 'Live' : 'Disconnected'}
          </span>
          <Link to={`/analytics/${sessionId}`}>
            <Button variant="outline" size="sm">View Analytics</Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          {error}
          <button
            onClick={() => window.location.reload()}
            className="underline hover:no-underline text-xs"
          >
            Reconnect
          </button>
        </div>
      )}

      {sessionEnded && (
        <div className="bg-primary/10 border border-primary/20 text-primary px-4 py-3 rounded-lg text-sm font-medium flex items-center justify-between">
          Session has ended. Final data is now available in Analytics.
          <Link to={`/analytics/${sessionId}`}>
            <Button size="sm">Go to Analytics →</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold font-mono text-primary">{formatElapsed(elapsed)}</div>
            <div className="text-xs text-muted-foreground mt-1">Elapsed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold">{totalClicks}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Clicks</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-accent">{formatMoney(moneyCounter)}</div>
            <div className="text-xs text-muted-foreground mt-1">Money Earned</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold">
              {snapshot?.startTimestamp ? formatTs(snapshot.startTimestamp) : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Started At</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last Click</CardTitle>
            {lastClick && (
              <CardDescription className="font-mono text-xs">{formatTs(lastClick.timestamp)}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {lastClick ? (() => {
              const { name, color } = getInputDisplay(lastClick.inputId);
              return (
                <div className="text-center space-y-3">
                  {color && (
                    <div
                      className="w-16 h-16 rounded-full mx-auto"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  <div className="text-2xl font-semibold">{name}</div>
                  {lastClick.awardedCents > 0 && (
                    <div className="text-sm text-primary font-medium">
                      +{formatMoney(lastClick.awardedCents)} awarded
                    </div>
                  )}
                </div>
              );
            })() : (
              <p className="text-muted-foreground text-sm text-center py-4">Waiting for clicks...</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Clicks</CardTitle>
            <CardDescription>Latest 20 events</CardDescription>
          </CardHeader>
          <CardContent>
            {recentClicks.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No clicks yet</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {recentClicks.map((click, i) => {
                  const { name, color } = getInputDisplay(click.inputId);
                  return (
                    <div
                      key={`${click.timestamp}-${i}`}
                      className="flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {color && (
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        )}
                        <span className="font-medium">{name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {click.awardedCents > 0 && (
                          <span className="text-primary font-medium">+{formatMoney(click.awardedCents)}</span>
                        )}
                        <span className="font-mono">{formatTs(click.timestamp)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {connected && !startTimestamp && !sessionEnded && (
        <Card>
          <CardContent className="p-6 text-center space-y-1">
            <p className="text-sm font-medium">Waiting for session to start...</p>
            <p className="text-xs text-muted-foreground">Connected. The session will begin when started on the participant's device.</p>
          </CardContent>
        </Card>
      )}

      {!connected && !sessionEnded && !error && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground text-sm">Connecting to session stream...</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
