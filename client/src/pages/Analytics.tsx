import { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { SessionDataResponse, SessionListItem, ChartDataPoint, ButtonPosition, Participant, ButtonShape, RawStoredConfig } from '../types';
import { calculateAccuracy, calculateClickRate, formatDuration, parseSqliteDate, formatTimestamp } from '../lib/utils';
import { normalizeConfig } from '../lib/normalizeConfig';

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getSessionNumber(sessionId: string): string {
  const parts = sessionId.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : sessionId;
}

function getButtonColor(config: SessionDataResponse['sessionConfig'], position: 'left' | 'middle' | 'right'): string {
  const fallbackColors = { left: '#5ccc96', middle: '#e39400', right: '#00a3cc' };
  const buttonKey = `${position}Button` as 'leftButton' | 'middleButton' | 'rightButton';
  if (config[buttonKey]?.color) return config[buttonKey]!.color;
  const legacyKey = `${position}ButtonColor` as 'leftButtonColor' | 'middleButtonColor' | 'rightButtonColor';
  if (config[legacyKey]) return config[legacyKey]!;
  return fallbackColors[position];
}

function getButtonShape(config: SessionDataResponse['sessionConfig'], position: 'left' | 'middle' | 'right'): ButtonShape {
  const buttonKey = `${position}Button` as 'leftButton' | 'middleButton' | 'rightButton';
  if (config[buttonKey]?.shape) return config[buttonKey]!.shape as ButtonShape;
  const legacyKey = `${position}ButtonShape` as 'leftButtonShape' | 'middleButtonShape' | 'rightButtonShape';
  if (config[legacyKey]) return config[legacyKey] as ButtonShape;
  return 'rectangle';
}

function ShapePreview({ shape, color, size = 24 }: { shape: ButtonShape; color: string; size?: number }) {
  if (shape === 'none') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <rect x="2" y="2" width="20" height="20" rx="2" fill={color} opacity={0.5} stroke={color} strokeWidth={1} strokeDasharray="3 2" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {shape === 'circle' && <circle cx="12" cy="12" r="10" fill={color} />}
      {shape === 'square' && <rect x="2" y="2" width="20" height="20" fill={color} />}
      {shape === 'rectangle' && <rect x="1" y="5" width="22" height="14" fill={color} />}
    </svg>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function Analytics() {
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const urlParticipantId = searchParams.get('participant');

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [participantSessions, setParticipantSessions] = useState<SessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(urlSessionId || null);
  const [sessionData, setSessionData] = useState<SessionDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    loadParticipants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (urlSessionId) {
      const parts = urlSessionId.split('-');
      if (parts.length >= 2) {
        const participantId = parts.slice(0, -1).join('-');
        setSelectedParticipantId(participantId);
        loadParticipantSessions(participantId).then(() => {
          setSelectedSessionId(urlSessionId);
          loadSessionData(urlSessionId);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSessionId]);

  useEffect(() => {
    if (urlParticipantId && !urlSessionId && participants.length > 0) {
      const found = participants.find(p => p.participantId === urlParticipantId);
      if (found) {
        setSelectedParticipantId(urlParticipantId);
        loadParticipantSessions(urlParticipantId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParticipantId, participants]);

  async function loadParticipants() {
    try {
      const data = await api.getParticipants();
      setParticipants(data);
      if (!urlSessionId && !urlParticipantId && data.length > 0) {
        setSelectedParticipantId(data[0].participantId);
        await loadParticipantSessions(data[0].participantId);
      }
    } catch (error) {
      console.error('Failed to load participants:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadParticipantSessions(participantId: string) {
    if (!participantId) { setParticipantSessions([]); return; }
    try {
      const data = await api.getParticipantSessions(participantId);
      setParticipantSessions(data);
      if (data.length > 0 && !urlSessionId) {
        setSelectedSessionId(data[0].sessionId);
        await loadSessionData(data[0].sessionId);
      }
    } catch (error) {
      console.error('Failed to load participant sessions:', error);
    }
  }

  async function loadSessionData(sessionId: string) {
    setLoading(true);
    setNotes('');
    setNotesSaved(false);
    try {
      const [data, notesData] = await Promise.all([
        api.getSessionData(sessionId),
        api.getSessionNotes(sessionId).catch(() => ({ sessionId, notes: '', updatedAt: null })),
      ]);
      setSessionData(data);
      setNotes(notesData.notes);
    } catch (error) {
      console.error('Failed to load session data:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleParticipantChange = async (participantId: string) => {
    setSelectedParticipantId(participantId);
    setSelectedSessionId(null);
    setSessionData(null);
    await loadParticipantSessions(participantId);
  };

  const handleSessionChange = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    loadSessionData(sessionId);
  };

  const chartData = useMemo((): ChartDataPoint[] => {
    if (!sessionData || !sessionData.startEvent) return [];

    const rawConfig = sessionData.sessionConfig as unknown as RawStoredConfig;
    const isNewModelConfig = Array.isArray(rawConfig.inputs);
    const startTime = parseSqliteDate(sessionData.startEvent.timestamp).getTime();

    if (isNewModelConfig) {
      let totalCount = 0;
      const perInputCounts: Record<string, number> = {};

      return sessionData.allClicks.map((click) => {
        const clickTime = parseSqliteDate(click.timestamp).getTime();
        const timeElapsed = (clickTime - startTime) / 1000;
        const raw = click as unknown as Record<string, unknown>;
        const inputId = (raw.inputId ?? click.buttonClicked) as string;

        totalCount++;
        perInputCounts[inputId] = (perInputCounts[inputId] ?? 0) + 1;

        return {
          timeElapsed: Number(timeElapsed.toFixed(2)),
          timestamp: click.timestamp,
          left: 0,
          middle: 0,
          right: 0,
          total: click.clickInfo?.total || totalCount,
          money: click.sessionInfo?.moneyCounter ?? 0,
          buttonClicked: click.buttonClicked,
          inputId,
          inputCounts: { ...perInputCounts },
        };
      });
    }

    let leftCount = 0;
    let middleCount = 0;
    let rightCount = 0;
    let totalCount = 0;
    let moneyCounter = sessionData.sessionConfig.startingMoney ? Number(sessionData.sessionConfig.startingMoney) : 0;
    const awardInterval = sessionData.sessionConfig.awardInterval ? Number(sessionData.sessionConfig.awardInterval) : 1;
    const moneyAwarded = sessionData.sessionConfig.moneyAwarded ? Number(sessionData.sessionConfig.moneyAwarded) : 0;
    const activeButton = sessionData.sessionConfig.buttonActive;
    let correctClicksSinceLastAward = 0;

    return sessionData.allClicks.map((click) => {
      const clickTime = parseSqliteDate(click.timestamp).getTime();
      const timeElapsed = (clickTime - startTime) / 1000;
      const hasNewFormat = click.clickInfo?.left !== undefined && click.clickInfo?.total !== undefined;

      if (hasNewFormat) {
        const sessionMoney = (click.sessionInfo as { moneyCounter?: number; pointsCounter?: number })?.moneyCounter
          ?? (click.sessionInfo as { moneyCounter?: number; pointsCounter?: number })?.pointsCounter
          ?? 0;
        return {
          timeElapsed: Number(timeElapsed.toFixed(2)),
          timestamp: click.timestamp,
          left: click.clickInfo?.left ?? 0,
          middle: click.clickInfo?.middle ?? 0,
          right: click.clickInfo?.right ?? 0,
          total: click.clickInfo?.total ?? 0,
          money: sessionMoney,
          buttonClicked: click.buttonClicked,
        };
      }

      totalCount++;
      if (click.buttonClicked === 'left') leftCount++;
      else if (click.buttonClicked === 'middle') middleCount++;
      else if (click.buttonClicked === 'right') rightCount++;

      if (click.buttonClicked === activeButton) {
        correctClicksSinceLastAward++;
        if (correctClicksSinceLastAward >= awardInterval) {
          moneyCounter += moneyAwarded;
          correctClicksSinceLastAward = 0;
        }
      }

      return {
        timeElapsed: Number(timeElapsed.toFixed(2)),
        timestamp: click.timestamp,
        left: leftCount,
        middle: middleCount,
        right: rightCount,
        total: totalCount,
        money: moneyCounter,
        buttonClicked: click.buttonClicked,
      };
    });
  }, [sessionData]);

  const stats = useMemo(() => {
    if (!sessionData || !sessionData.startEvent) return null;

    const startTime = parseSqliteDate(sessionData.startEvent.timestamp).getTime();
    let endTime: number;
    if (sessionData.endEvent) {
      endTime = parseSqliteDate(sessionData.endEvent.timestamp).getTime();
    } else if (sessionData.allClicks.length > 0) {
      endTime = parseSqliteDate(sessionData.allClicks[sessionData.allClicks.length - 1].timestamp).getTime();
    } else {
      endTime = startTime;
    }
    const duration = (endTime - startTime) / 1000;
    const totalClicks = sessionData.allClicks.length;

    const rawConfig = sessionData.sessionConfig as unknown as RawStoredConfig;
    let correctClicks: number;
    if (Array.isArray(rawConfig.inputs)) {
      const normalizedConf = normalizeConfig(rawConfig);
      const rewardedIds = new Set(normalizedConf.inputs.filter(i => i.isRewarded).map(i => i.id));
      correctClicks = sessionData.allClicks.filter(c => {
        const raw = c as unknown as Record<string, unknown>;
        return rewardedIds.has((raw.inputId ?? c.buttonClicked) as string);
      }).length;
    } else {
      correctClicks = sessionData.allClicks.filter(
        (c) => c.buttonClicked === sessionData.sessionConfig.buttonActive
      ).length;
    }

    let finalMoney: number | undefined;
    if (sessionData.endEvent?.value?.moneyCounter !== undefined) {
      finalMoney = sessionData.endEvent.value.moneyCounter;
    } else if (sessionData.allClicks.length > 0) {
      const lastClick = sessionData.allClicks[sessionData.allClicks.length - 1];
      if (typeof lastClick.clickInfo === 'object' && 'moneyCounter' in lastClick.clickInfo) {
        finalMoney = (lastClick.clickInfo as { moneyCounter: number }).moneyCounter;
      } else if (lastClick.sessionInfo?.moneyCounter !== undefined) {
        finalMoney = lastClick.sessionInfo.moneyCounter;
      }
    }
    if (finalMoney === undefined && chartData.length > 0) {
      finalMoney = chartData[chartData.length - 1].money;
    }

    return {
      duration,
      totalClicks,
      correctClicks,
      incorrectClicks: totalClicks - correctClicks,
      accuracy: calculateAccuracy(correctClicks, totalClicks),
      clickRate: calculateClickRate(totalClicks, duration),
      finalMoney: finalMoney ?? 0,
    };
  }, [sessionData, chartData]);

  const clickStats = useMemo((): Record<string, {
    firstClickTime: string | null;
    timeToFirstClick: number | null;
    totalClicks: number;
  }> | null => {
    if (!sessionData || !sessionData.startEvent) return null;

    const startTime = parseSqliteDate(sessionData.startEvent.timestamp).getTime();
    const rawConfig = sessionData.sessionConfig as unknown as RawStoredConfig;

    if (Array.isArray(rawConfig.inputs)) {
      const result: Record<string, { firstClickTime: string | null; timeToFirstClick: number | null; totalClicks: number }> = {};
      for (const click of sessionData.allClicks) {
        const raw = click as unknown as Record<string, unknown>;
        const inputId = (raw.inputId ?? click.buttonClicked) as string;
        if (!result[inputId]) {
          result[inputId] = { firstClickTime: null, timeToFirstClick: null, totalClicks: 0 };
        }
        result[inputId].totalClicks++;
        if (!result[inputId].firstClickTime) {
          const t = parseSqliteDate(click.timestamp);
          result[inputId].firstClickTime = t.toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
            fractionalSecondDigits: 2,
          });
          result[inputId].timeToFirstClick = Number(((t.getTime() - startTime) / 1000).toFixed(3));
        }
      }
      return result;
    }

    const buttons: ButtonPosition[] = ['left', 'middle', 'right'];
    const result: Record<string, { firstClickTime: string | null; timeToFirstClick: number | null; totalClicks: number }> = {
      left: { firstClickTime: null, timeToFirstClick: null, totalClicks: 0 },
      middle: { firstClickTime: null, timeToFirstClick: null, totalClicks: 0 },
      right: { firstClickTime: null, timeToFirstClick: null, totalClicks: 0 },
    };
    for (const button of buttons) {
      const buttonClicks = sessionData.allClicks.filter(c => c.buttonClicked === button);
      result[button].totalClicks = buttonClicks.length;
      if (buttonClicks.length > 0) {
        const t = parseSqliteDate(buttonClicks[0].timestamp);
        result[button].firstClickTime = t.toLocaleTimeString('en-US', {
          hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
          fractionalSecondDigits: 2,
        });
        result[button].timeToFirstClick = Number(((t.getTime() - startTime) / 1000).toFixed(3));
      }
    }
    return result;
  }, [sessionData]);

  const exportCSV = () => {
    if (!chartData.length || !sessionData) return;

    const rawConfig = sessionData.sessionConfig as unknown as RawStoredConfig;
    const isNewModelExport = Array.isArray(rawConfig.inputs);
    let headers: string[];
    let rows: unknown[][];

    if (isNewModelExport) {
      const normalizedConf = normalizeConfig(rawConfig);
      const inputNameMap = new Map(normalizedConf.inputs.map(i => [i.id, i.name]));
      headers = ['Time (s)', 'Input ID', 'Input Name', 'Total Clicks', 'Input Clicks', 'Money (cents)'];
      rows = chartData.map((d) => [
        d.timeElapsed,
        d.inputId ?? '',
        d.inputId ? (inputNameMap.get(d.inputId) ?? '') : '',
        d.total,
        d.inputId ? (d.inputCounts?.[d.inputId] ?? 0) : 0,
        d.money,
      ]);
    } else {
      headers = ['Time (s)', 'Button', 'Total Clicks', 'Left', 'Middle', 'Right', 'Money (cents)'];
      rows = chartData.map((d) => [d.timeElapsed, d.buttonClicked, d.total, d.left, d.middle, d.right, d.money]);
    }

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${selectedSessionId}-data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveNotes = async () => {
    if (!selectedSessionId) return;
    setNotesSaving(true);
    try {
      await api.updateSessionNotes(selectedSessionId, notes);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save notes:', error);
    } finally {
      setNotesSaving(false);
    }
  };

  const exportJSON = () => {
    if (!sessionData) return;
    const data = {
      sessionId: selectedSessionId,
      sessionConfig: sessionData.sessionConfig,
      startEvent: sessionData.startEvent,
      endEvent: sessionData.endEvent,
      clicks: sessionData.allClicks,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${selectedSessionId}-data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !sessionData) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
          <p className="text-muted-foreground mt-2">Session data visualization and analysis</p>
        </div>
        {sessionData && (
          <div className="flex gap-2">
            {chartData.length > 0 && (
              <Button onClick={exportCSV} variant="outline">Export CSV</Button>
            )}
            <Button onClick={exportJSON} variant="outline">Export JSON</Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Participant ID</label>
              <select
                value={selectedParticipantId}
                onChange={(e) => handleParticipantChange(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a participant...</option>
                {participants.map((p) => (
                  <option key={p.participantId} value={p.participantId}>
                    {p.participantId} ({p.sessionCount} sessions)
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Session</label>
              <select
                value={selectedSessionId || ''}
                onChange={(e) => handleSessionChange(e.target.value)}
                disabled={!selectedParticipantId || participantSessions.length === 0}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Select a session...</option>
                {participantSessions.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {getSessionNumber(session.sessionId)} - {session.startedAt ? formatTimestamp(session.startedAt) : 'N/A'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!sessionData && !loading && (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">No session data available. Create a session first!</p>
          </CardContent>
        </Card>
      )}

      {sessionData && stats && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="bg-gradient-to-br from-card to-card/80">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  Session Overview
                </CardTitle>
                <CardDescription>
                  {sessionData.startEvent ? parseSqliteDate(sessionData.startEvent.timestamp).toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  }) : 'N/A'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border/50 p-4 text-center">
                    <div className="text-xl font-mono font-bold">
                      {sessionData.startEvent ? parseSqliteDate(sessionData.startEvent.timestamp).toLocaleTimeString('en-US', { hour12: false }) : 'N/A'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Start Time</div>
                  </div>
                  <div className="rounded-lg border border-border/50 p-4 text-center">
                    <div className="text-xl font-mono font-bold">
                      {sessionData.endEvent ? parseSqliteDate(sessionData.endEvent.timestamp).toLocaleTimeString('en-US', { hour12: false }) : 'In Progress'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">End Time</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-center">
                    <div className="text-3xl font-bold text-primary">{formatDuration(stats.duration)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Duration</div>
                  </div>
                  <div className="rounded-lg bg-accent/10 border border-accent/20 p-4 text-center">
                    <div className="text-3xl font-bold text-accent">{formatMoney(stats.finalMoney)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Money Earned</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 rounded-lg border border-border/50 bg-muted/30">
                    <div className="text-2xl font-bold">{stats.totalClicks}</div>
                    <div className="text-xs text-muted-foreground">Total Clicks</div>
                  </div>
                  <div className="text-center p-3 rounded-lg border border-border/50 bg-muted/30">
                    <div className="text-2xl font-bold">{stats.accuracy}%</div>
                    <div className="text-xs text-muted-foreground">Accuracy</div>
                  </div>
                  <div className="text-center p-3 rounded-lg border border-border/50 bg-muted/30">
                    <div className="text-2xl font-bold">{stats.clickRate}/s</div>
                    <div className="text-xs text-muted-foreground">Click Rate</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-card to-card/80">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent"></span>
                  Configuration
                </CardTitle>
                <CardDescription>Session parameters</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg border border-border/50 p-3 text-center">
                    <div className="text-lg font-bold">{sessionData.sessionConfig.timeLimit ?? 60}s</div>
                    <div className="text-xs text-muted-foreground mt-1">Time Limit</div>
                  </div>
                  <div className="rounded-lg border border-border/50 p-3 text-center">
                    <div className="text-lg font-bold">{formatMoney(sessionData.sessionConfig.moneyLimit ?? 100)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Money Limit</div>
                  </div>
                  <div className="rounded-lg border border-border/50 p-3 text-center">
                    <div className="text-lg font-bold">
                      {sessionData.sessionConfig.continueAfterMoneyLimit ? 'off' : 'on'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">End At Limit</div>
                  </div>
                  <div className="rounded-lg border border-border/50 p-3 text-center">
                    <div className="text-lg font-bold">
                      {(() => {
                        const normalized = normalizeConfig(sessionData.sessionConfig as unknown as RawStoredConfig);
                        return normalized.inputs.some(i => i.isRewarded && i.playAwardSound) ? 'on' : 'off';
                      })()}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Award Sound</div>
                  </div>
                </div>
                {(() => {
                  const normalized = normalizeConfig(sessionData.sessionConfig as unknown as RawStoredConfig);
                  const rewardedInputs = normalized.inputs.filter(i => i.isRewarded);
                  return (
                    <>
                      <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-center">
                        <div className="text-lg font-bold text-primary">
                          {rewardedInputs.length > 0
                            ? rewardedInputs.map(i => i.name || 'Unnamed').join(', ')
                            : 'None'}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Rewarded Input{rewardedInputs.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {rewardedInputs.length > 0 ? (
                          <>
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
                              <div className="text-xl font-bold">{formatMoney(rewardedInputs[0].moneyAwarded)}</div>
                              <div className="text-xs text-muted-foreground mt-1">Money Awarded</div>
                            </div>
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
                              <div className="text-xl font-bold">{rewardedInputs[0].awardInterval}</div>
                              <div className="text-xs text-muted-foreground mt-1">Award Interval</div>
                            </div>
                          </>
                        ) : (
                          <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center col-span-2">
                            <div className="text-sm text-muted-foreground">No rewards configured</div>
                          </div>
                        )}
                        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
                          <div className="text-xl font-bold">{formatMoney(normalized.startingMoney ?? 0)}</div>
                          <div className="text-xs text-muted-foreground mt-1">Starting Money</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {normalized.inputs.length} input{normalized.inputs.length !== 1 ? 's' : ''} configured
                        ({normalized.inputs.filter(i => i.type === 'screen').length} screen,{' '}
                        {normalized.inputs.filter(i => i.type !== 'screen').length} physical)
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {(() => {
            const rawConfig = sessionData.sessionConfig as unknown as RawStoredConfig;
            const isNewModelCharts = Array.isArray(rawConfig.inputs);
            const DOT_SIZE = 5;
            const colorDot = (color: string) => (props: { cx?: number; cy?: number }) => (
              <circle cx={props.cx} cy={props.cy} r={DOT_SIZE} fill={color} stroke={color} strokeWidth={1} />
            );

            if (isNewModelCharts) {
              const CHART_PALETTE = ['#5ccc96', '#e39400', '#00a3cc', '#b3a1e6', '#ce6f8f', '#42b3c2', '#f2ce00'];
              const normalizedConf = normalizeConfig(rawConfig);
              const inputsWithColors = normalizedConf.inputs.map((input, i) => ({
                ...input,
                chartColor: input.color ?? CHART_PALETTE[i % CHART_PALETTE.length],
              }));

              return (
                <>
                  {clickStats && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Click Distribution</CardTitle>
                        <CardDescription>Breakdown by input</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          {inputsWithColors.map((input) => {
                            const stat = clickStats[input.id] ?? { totalClicks: 0, firstClickTime: null, timeToFirstClick: null };
                            return (
                              <div key={input.id} className="relative">
                                <div
                                  className="rounded-xl p-6 text-center transition-transform hover:scale-[1.02]"
                                  style={{ backgroundColor: hexToRgba(input.chartColor, 0.08), border: `2px solid ${input.chartColor}` }}
                                >
                                  <div className="text-lg font-bold mb-1" style={{ color: input.chartColor }}>
                                    {input.name || 'Unnamed'}
                                  </div>
                                  {input.type === 'screen' && input.shape && input.shape !== 'none' && (
                                    <div className="flex justify-center mb-2">
                                      <ShapePreview shape={input.shape} color={input.color ?? input.chartColor} size={28} />
                                    </div>
                                  )}
                                  {input.type !== 'screen' && (
                                    <div className="text-xs font-mono text-muted-foreground mb-2 truncate">
                                      {input.inputLabel ?? input.type}
                                    </div>
                                  )}
                                  <div className="text-6xl font-bold mb-3" style={{ color: input.chartColor }}>
                                    {stat.totalClicks}
                                  </div>
                                  <div className="space-y-3 text-sm">
                                    <div className="flex justify-between items-center">
                                      <span className="text-muted-foreground">First Click</span>
                                      <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                                        {stat.firstClickTime ?? '—'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-muted-foreground">Time to Click</span>
                                      <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                                        {stat.timeToFirstClick !== null ? `${stat.timeToFirstClick}s` : '—'}
                                      </span>
                                    </div>
                                  </div>
                                  {input.isRewarded && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-semibold shadow-lg">
                                      ★ Rewarded
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle>Click Timeline - Per Input</CardTitle>
                      <CardDescription>
                        Cumulative clicks per input over time
                        <span className="ml-6 inline-flex flex-wrap gap-4">
                          {inputsWithColors.map(input => (
                            <span key={input.id} className="inline-flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: input.chartColor }} />
                              {input.name || 'Input'}
                            </span>
                          ))}
                        </span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={350}>
                        <ScatterChart margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                          <XAxis dataKey="x" type="number" name="Time"
                            domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                            stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                            label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                          />
                          <YAxis dataKey="y" type="number" name="Clicks"
                            domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
                            stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                            label={{ value: 'Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                          />
                          <Tooltip cursor={{ strokeDasharray: '3 3' }}
                            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                            labelStyle={{ color: '#fff' }}
                            formatter={(value: number, name: string) => [value, name]}
                            labelFormatter={(value: number) => `Time: ${value.toFixed(1)}s`}
                          />
                          {inputsWithColors.map(input => (
                            <Scatter key={input.id} name={input.name || 'Input'}
                              data={chartData.filter(d => d.inputId === input.id).map(d => ({
                                x: d.timeElapsed, y: d.inputCounts?.[input.id] ?? 0,
                              }))}
                              fill={input.chartColor} shape={colorDot(input.chartColor)}
                            />
                          ))}
                        </ScatterChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Click Timeline - Total Clicks</CardTitle>
                      <CardDescription>
                        All clicks colored by input
                        <span className="ml-6 inline-flex flex-wrap gap-4">
                          {inputsWithColors.map(input => (
                            <span key={input.id} className="inline-flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: input.chartColor }} />
                              {input.name || 'Input'}
                            </span>
                          ))}
                        </span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={350}>
                        <ScatterChart margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                          <XAxis dataKey="x" type="number" name="Time"
                            domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                            stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                            label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                          />
                          <YAxis dataKey="y" type="number" name="Total"
                            domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
                            stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                            label={{ value: 'Total Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                          />
                          <Tooltip cursor={{ strokeDasharray: '3 3' }}
                            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                            labelStyle={{ color: '#fff' }}
                            formatter={(value: number, name: string) => [value, name]}
                            labelFormatter={(value: number) => `Time: ${value.toFixed(1)}s`}
                          />
                          {inputsWithColors.map(input => (
                            <Scatter key={input.id} name={input.name || 'Input'}
                              data={chartData.filter(d => d.inputId === input.id).map(d => ({
                                x: d.timeElapsed, y: d.total,
                              }))}
                              fill={input.chartColor} shape={colorDot(input.chartColor)}
                            />
                          ))}
                        </ScatterChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </>
              );
            }

            const CHART_COLORS = { left: '#5ccc96', middle: '#e39400', right: '#00a3cc' };
            const positions = ['left', 'middle', 'right'] as const;

            return (
              <>
                {clickStats && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Click Distribution</CardTitle>
                      <CardDescription>Detailed breakdown by button</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {positions.map((position) => {
                          const chartColor = CHART_COLORS[position];
                          const configColor = getButtonColor(sessionData.sessionConfig, position);
                          const shape = getButtonShape(sessionData.sessionConfig, position);
                          const stat = clickStats[position] ?? { totalClicks: 0, firstClickTime: null, timeToFirstClick: null };
                          const isActive = sessionData.sessionConfig.buttonActive === position;
                          if (shape === 'none') return null;
                          return (
                            <div key={position} className="relative">
                              <div
                                className="rounded-xl p-6 text-center transition-transform hover:scale-[1.02]"
                                style={{ backgroundColor: hexToRgba(chartColor, 0.08), border: `2px solid ${chartColor}` }}
                              >
                                <div className="flex justify-center items-center gap-2 mb-3">
                                  <ShapePreview shape={shape} color={configColor} size={32} />
                                  <span className="text-xs text-muted-foreground font-mono">{configColor}</span>
                                </div>
                                <div className="text-6xl font-bold mb-3" style={{ color: chartColor }}>
                                  {stat.totalClicks}
                                </div>
                                <div className="text-sm font-semibold mb-4 capitalize" style={{ color: chartColor }}>{position} Button</div>
                                <div className="space-y-3 text-sm">
                                  <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">First Click</span>
                                    <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                                      {stat.firstClickTime ?? '—'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Time to Click</span>
                                    <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                                      {stat.timeToFirstClick !== null ? `${stat.timeToFirstClick}s` : '—'}
                                    </span>
                                  </div>
                                </div>
                                {isActive && (
                                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-semibold shadow-lg">
                                    ★ Active
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle>Click Timeline - Individual Buttons</CardTitle>
                    <CardDescription>
                      Cumulative clicks per button over time
                      <span className="ml-6 inline-flex gap-4">
                        {positions.map(pos => (
                          <span key={pos} className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[pos] }} />
                            {pos.charAt(0).toUpperCase() + pos.slice(1)}
                          </span>
                        ))}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <ScatterChart margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                        <XAxis dataKey="x" type="number" name="Time"
                          domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                          stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                          label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                        />
                        <YAxis dataKey="y" type="number" name="Clicks"
                          domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
                          stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                          label={{ value: 'Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                        />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }}
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                          labelStyle={{ color: '#fff' }}
                          formatter={(value: number, name: string) => [value, name]}
                          labelFormatter={(value: number) => `Time: ${value.toFixed(1)}s`}
                        />
                        <Scatter name="Left Button"
                          data={chartData.filter((d) => d.buttonClicked === 'left').map(d => ({ x: d.timeElapsed, y: d.left }))}
                          fill={CHART_COLORS.left} shape={colorDot(CHART_COLORS.left)}
                        />
                        <Scatter name="Middle Button"
                          data={chartData.filter((d) => d.buttonClicked === 'middle').map(d => ({ x: d.timeElapsed, y: d.middle }))}
                          fill={CHART_COLORS.middle} shape={colorDot(CHART_COLORS.middle)}
                        />
                        <Scatter name="Right Button"
                          data={chartData.filter((d) => d.buttonClicked === 'right').map(d => ({ x: d.timeElapsed, y: d.right }))}
                          fill={CHART_COLORS.right} shape={colorDot(CHART_COLORS.right)}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Click Timeline - Total Clicks</CardTitle>
                    <CardDescription>
                      All clicks colored by button
                      <span className="ml-6 inline-flex gap-4">
                        {positions.map(pos => (
                          <span key={pos} className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[pos] }} />
                            {pos.charAt(0).toUpperCase() + pos.slice(1)}
                          </span>
                        ))}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <ScatterChart margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                        <XAxis dataKey="x" type="number" name="Time"
                          domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                          stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                          label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                        />
                        <YAxis dataKey="y" type="number" name="Total"
                          domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
                          stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                          label={{ value: 'Total Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                        />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }}
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                          labelStyle={{ color: '#fff' }}
                          formatter={(value: number, name: string) => [value, name]}
                          labelFormatter={(value: number) => `Time: ${value.toFixed(1)}s`}
                        />
                        <Scatter name="Left Button"
                          data={chartData.filter((d) => d.buttonClicked === 'left').map(d => ({ x: d.timeElapsed, y: d.total }))}
                          fill={CHART_COLORS.left} shape={colorDot(CHART_COLORS.left)}
                        />
                        <Scatter name="Middle Button"
                          data={chartData.filter((d) => d.buttonClicked === 'middle').map(d => ({ x: d.timeElapsed, y: d.total }))}
                          fill={CHART_COLORS.middle} shape={colorDot(CHART_COLORS.middle)}
                        />
                        <Scatter name="Right Button"
                          data={chartData.filter((d) => d.buttonClicked === 'right').map(d => ({ x: d.timeElapsed, y: d.total }))}
                          fill={CHART_COLORS.right} shape={colorDot(CHART_COLORS.right)}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            );
          })()}

          <Card>
            <CardHeader>
              <CardTitle>Money Accumulation</CardTitle>
              <CardDescription>Money earned over time</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const moneyValues = chartData.map(d => d.money);
                const minMoney = Math.min(...moneyValues);
                const maxMoney = Math.max(...moneyValues, 0);
                if (maxMoney === 0 && minMoney === 0) {
                  return (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No money earned in this session
                    </div>
                  );
                }
                const range = maxMoney - minMoney;
                const padding = range > 0 ? Math.ceil(range * 0.1) : Math.max(Math.ceil(maxMoney * 0.1), 50);
                const yMin = Math.max(0, minMoney - padding);
                const yMax = maxMoney + padding;
                return (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData} margin={{ top: 20, right: 30, bottom: 50, left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                      <XAxis dataKey="timeElapsed" type="number"
                        domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                        stroke="#888" tick={{ fill: '#888' }} allowDecimals={false}
                        label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                      />
                      <YAxis dataKey="money" domain={[yMin, yMax]}
                        stroke="#888" tick={{ fill: '#888' }}
                        tickFormatter={(value: number) => `$${(value / 100).toFixed(2)}`}
                        label={{ value: 'Money Earned', angle: -90, position: 'insideLeft', offset: -15, fill: '#888' }}
                      />
                      <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                        labelStyle={{ color: '#fff' }}
                        formatter={(value: number) => [formatMoney(value), 'Money']}
                        labelFormatter={(value: number) => `Time: ${value.toFixed(1)}s`}
                      />
                      <Line type="stepAfter" dataKey="money" stroke="#b3a1e6" strokeWidth={2} dot={{ r: 3, fill: '#b3a1e6' }} />
                    </LineChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Session Notes</CardTitle>
              <CardDescription>Observations and annotations for this session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setNotesSaved(false); }}
                placeholder="Add observations, notes, or comments about this session..."
                className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex items-center gap-3">
                <Button onClick={saveNotes} disabled={notesSaving} size="sm">
                  {notesSaving ? 'Saving...' : 'Save Notes'}
                </Button>
                {notesSaved && (
                  <span className="text-sm text-primary">✓ Saved</span>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
