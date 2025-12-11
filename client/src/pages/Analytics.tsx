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
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { SessionDataResponse, SessionListItem, ChartDataPoint, ButtonPosition, Participant } from '../types';
import { calculateAccuracy, calculateClickRate, formatDuration, parseSqliteDate, formatTimestamp } from '../lib/utils';

// Format money - display in dollars with $ sign
function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Extract session number from composite sessionId (e.g., "100-1" -> "1")
function getSessionNumber(sessionId: string): string {
  const parts = sessionId.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : sessionId;
}

export function Analytics() {
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const urlParticipantId = searchParams.get('participant');
  
  // Cascading dropdown state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [participantSessions, setParticipantSessions] = useState<SessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(urlSessionId || null);
  const [sessionData, setSessionData] = useState<SessionDataResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Load participants on mount
  useEffect(() => {
    loadParticipants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If URL has sessionId, extract participantId and load
  useEffect(() => {
    if (urlSessionId) {
      // Session IDs are formatted as "participantId-sequenceNumber"
      const parts = urlSessionId.split('-');
      if (parts.length >= 2) {
        const participantId = parts.slice(0, -1).join('-'); // Handle participant IDs with dashes
        setSelectedParticipantId(participantId);
        loadParticipantSessions(participantId).then(() => {
          setSelectedSessionId(urlSessionId);
          loadSessionData(urlSessionId);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSessionId]);

  // If URL has ?participant= param, pre-select that participant
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
      
      // If no URL session or participant specified, select first participant
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
    if (!participantId) {
      setParticipantSessions([]);
      return;
    }
    try {
      const data = await api.getParticipantSessions(participantId);
      setParticipantSessions(data);
      
      // Auto-select first session for this participant
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
    try {
      const data = await api.getSessionData(sessionId);
      setSessionData(data);
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

    const startTime = parseSqliteDate(sessionData.startEvent.timestamp).getTime();
    
    // Track cumulative counts for old data format that doesn't have them
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
      
      // Check if data has new format (cumulative counts) or old format
      const hasNewFormat = click.clickInfo?.left !== undefined && click.clickInfo?.total !== undefined;
      
      if (hasNewFormat) {
        return {
          timeElapsed: Number(timeElapsed.toFixed(2)),
          timestamp: click.timestamp,
          left: click.clickInfo?.left ?? 0,
          middle: click.clickInfo?.middle ?? 0,
          right: click.clickInfo?.right ?? 0,
          total: click.clickInfo?.total ?? 0,
          money: click.sessionInfo?.moneyCounter ?? 0,
          buttonClicked: click.buttonClicked,
        };
      }
      
      // Old format: compute cumulative counts
      totalCount++;
      if (click.buttonClicked === 'left') leftCount++;
      else if (click.buttonClicked === 'middle') middleCount++;
      else if (click.buttonClicked === 'right') rightCount++;
      
      // Compute money for old data
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
    // For sessions without end event, use last click timestamp instead of Date.now()
    let endTime: number;
    if (sessionData.endEvent) {
      endTime = parseSqliteDate(sessionData.endEvent.timestamp).getTime();
    } else if (sessionData.allClicks.length > 0) {
      endTime = parseSqliteDate(sessionData.allClicks[sessionData.allClicks.length - 1].timestamp).getTime();
    } else {
      endTime = startTime; // No clicks, duration is 0
    }
    const duration = (endTime - startTime) / 1000;

    const totalClicks = sessionData.allClicks.length;
    const correctClicks = sessionData.allClicks.filter(
      (c) => c.buttonClicked === sessionData.sessionConfig.buttonActive
    ).length;

    // Get final money from various sources - old event format stores in click value directly
    let finalMoney: number | undefined;
    
    // Try endEvent first
    if (sessionData.endEvent?.value?.moneyCounter !== undefined) {
      finalMoney = sessionData.endEvent.value.moneyCounter;
    }
    // Try last click's sessionInfo
    else if (sessionData.allClicks.length > 0) {
      const lastClick = sessionData.allClicks[sessionData.allClicks.length - 1];
      // Old format: value is JSON string with moneyCounter
      if (typeof lastClick.clickInfo === 'object' && 'moneyCounter' in lastClick.clickInfo) {
        finalMoney = (lastClick.clickInfo as { moneyCounter: number }).moneyCounter;
      } else if (lastClick.sessionInfo?.moneyCounter !== undefined) {
        finalMoney = lastClick.sessionInfo.moneyCounter;
      }
    }
    
    // Fallback to computed chartData
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

  // Calculate detailed click stats per button
  const clickStats = useMemo(() => {
    if (!sessionData || !sessionData.startEvent) return null;

    const startTime = parseSqliteDate(sessionData.startEvent.timestamp).getTime();
    const buttons: ButtonPosition[] = ['left', 'middle', 'right'];
    
    const result: Record<ButtonPosition, {
      firstClickTime: string | null;
      timeToFirstClick: number | null;
      totalClicks: number;
    }> = {
      left: { firstClickTime: null, timeToFirstClick: null, totalClicks: 0 },
      middle: { firstClickTime: null, timeToFirstClick: null, totalClicks: 0 },
      right: { firstClickTime: null, timeToFirstClick: null, totalClicks: 0 },
    };

    for (const button of buttons) {
      const buttonClicks = sessionData.allClicks.filter(c => c.buttonClicked === button);
      result[button].totalClicks = buttonClicks.length;
      
      if (buttonClicks.length > 0) {
        const firstClick = buttonClicks[0];
        const firstClickTime = parseSqliteDate(firstClick.timestamp);
        result[button].firstClickTime = firstClickTime.toLocaleTimeString('en-US', { 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit',
          fractionalSecondDigits: 2
        });
        result[button].timeToFirstClick = Number(((firstClickTime.getTime() - startTime) / 1000).toFixed(3));
      }
    }

    return result;
  }, [sessionData]);

  const exportCSV = () => {
    if (!chartData.length || !sessionData) return;

    const headers = ['Time (s)', 'Button', 'Total Clicks', 'Left', 'Middle', 'Right', 'Money (cents)'];
    const rows = chartData.map((d) => [
      d.timeElapsed,
      d.buttonClicked,
      d.total,
      d.left,
      d.middle,
      d.right,
      d.money,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${selectedSessionId}-data.csv`;
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
        {chartData.length > 0 && (
          <Button onClick={exportCSV} variant="outline">
            Export CSV
          </Button>
        )}
      </div>

      {/* Cascading Participant/Session Selectors */}
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
          {/* Session Overview - Combined Config & Results */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left Column - Session Info */}
            <Card className="bg-gradient-to-br from-card to-card/80">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  Session Overview
                </CardTitle>
                <CardDescription>
                  {sessionData.startEvent ? parseSqliteDate(sessionData.startEvent.timestamp).toLocaleDateString('en-US', { 
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                  }) : 'N/A'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Time Info */}
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

                {/* Key Metrics */}
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

                {/* Performance Stats */}
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

            {/* Right Column - Configuration */}
            <Card className="bg-gradient-to-br from-card to-card/80">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent"></span>
                  Configuration
                </CardTitle>
                <CardDescription>Session parameters</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Session Limits - 4 columns */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg border border-border/50 p-3 text-center">
                    <div className="text-lg font-bold">
                      {sessionData.sessionConfig.timeLimit ?? 60}s
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Time Limit</div>
                  </div>
                  <div className="rounded-lg border border-border/50 p-3 text-center">
                    <div className="text-lg font-bold">
                      {formatMoney(sessionData.sessionConfig.moneyLimit ?? 100)}
                    </div>
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
                      {sessionData.sessionConfig.playAwardSound ? 'on' : 'off'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Award Sound</div>
                  </div>
                </div>

                {/* Active Button - highlighted */}
                <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-center">
                  <div className="text-2xl font-bold text-primary capitalize">
                    {sessionData.sessionConfig.buttonActive}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Active Button</div>
                </div>

                {/* Money Configuration - 3 columns */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
                    <div className="text-xl font-bold">
                      {formatMoney(sessionData.sessionConfig.moneyAwarded ?? 5)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Money Awarded</div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
                    <div className="text-xl font-bold">
                      {sessionData.sessionConfig.awardInterval ?? 10}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Award Interval</div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
                    <div className="text-xl font-bold">
                      {formatMoney(sessionData.sessionConfig.startingMoney ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Starting Money</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Click Distribution - Visual Cards */}
          {clickStats && (
            <Card>
              <CardHeader>
                <CardTitle>Click Distribution</CardTitle>
                <CardDescription>Detailed breakdown by button</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Left Button */}
                  <div className="relative">
                    <div 
                      className="rounded-xl p-6 text-center transition-transform hover:scale-[1.02]" 
                      style={{ backgroundColor: 'rgba(92, 204, 150, 0.1)', border: '2px solid #5ccc96' }}
                    >
                      <div className="text-6xl font-bold mb-3" style={{ color: '#5ccc96' }}>
                        {clickStats.left.totalClicks}
                      </div>
                      <div className="text-sm font-semibold mb-4" style={{ color: '#5ccc96' }}>Left Button</div>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">First Click</span>
                          <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                            {clickStats.left.firstClickTime ?? '—'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Time to Click</span>
                          <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                            {clickStats.left.timeToFirstClick !== null ? `${clickStats.left.timeToFirstClick}s` : '—'}
                          </span>
                        </div>
                      </div>
                      {sessionData.sessionConfig.buttonActive === 'left' && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-semibold shadow-lg">
                          ★ Active
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Middle Button */}
                  <div className="relative">
                    <div 
                      className="rounded-xl p-6 text-center transition-transform hover:scale-[1.02]" 
                      style={{ backgroundColor: 'rgba(227, 148, 0, 0.1)', border: '2px solid #e39400' }}
                    >
                      <div className="text-6xl font-bold mb-3" style={{ color: '#e39400' }}>
                        {clickStats.middle.totalClicks}
                      </div>
                      <div className="text-sm font-semibold mb-4" style={{ color: '#e39400' }}>Middle Button</div>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">First Click</span>
                          <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                            {clickStats.middle.firstClickTime ?? '—'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Time to Click</span>
                          <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                            {clickStats.middle.timeToFirstClick !== null ? `${clickStats.middle.timeToFirstClick}s` : '—'}
                          </span>
                        </div>
                      </div>
                      {sessionData.sessionConfig.buttonActive === 'middle' && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-semibold shadow-lg">
                          ★ Active
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Button */}
                  <div className="relative">
                    <div 
                      className="rounded-xl p-6 text-center transition-transform hover:scale-[1.02]" 
                      style={{ backgroundColor: 'rgba(0, 163, 204, 0.1)', border: '2px solid #00a3cc' }}
                    >
                      <div className="text-6xl font-bold mb-3" style={{ color: '#00a3cc' }}>
                        {clickStats.right.totalClicks}
                      </div>
                      <div className="text-sm font-semibold mb-4" style={{ color: '#00a3cc' }}>Right Button</div>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">First Click</span>
                          <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                            {clickStats.right.firstClickTime ?? '—'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Time to Click</span>
                          <span className="font-mono text-xs bg-background/50 px-2 py-1 rounded">
                            {clickStats.right.timeToFirstClick !== null ? `${clickStats.right.timeToFirstClick}s` : '—'}
                          </span>
                        </div>
                      </div>
                      {sessionData.sessionConfig.buttonActive === 'right' && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-semibold shadow-lg">
                          ★ Active
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Charts */}
          <Card>
            <CardHeader>
              <CardTitle>Click Timeline - Individual Buttons</CardTitle>
              <CardDescription>Cumulative clicks per button over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart margin={{ top: 20, right: 30, bottom: 50, left: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    name="Time"
                    domain={[0, 'auto']}
                    stroke="#888"
                    tick={{ fill: '#888' }}
                    label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                  />
                  <YAxis
                    dataKey="y"
                    type="number"
                    name="Clicks"
                    domain={[0, 'auto']}
                    stroke="#888"
                    tick={{ fill: '#888' }}
                    label={{ value: 'Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter
                    name="Left Button"
                    data={chartData.filter((d) => d.buttonClicked === 'left').map(d => ({ x: d.timeElapsed, y: d.left }))}
                    fill="#5ccc96"
                  />
                  <Scatter
                    name="Middle Button"
                    data={chartData.filter((d) => d.buttonClicked === 'middle').map(d => ({ x: d.timeElapsed, y: d.middle }))}
                    fill="#e39400"
                  />
                  <Scatter
                    name="Right Button"
                    data={chartData.filter((d) => d.buttonClicked === 'right').map(d => ({ x: d.timeElapsed, y: d.right }))}
                    fill="#00a3cc"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Click Timeline - Total Clicks</CardTitle>
              <CardDescription>All clicks colored by button</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart margin={{ top: 20, right: 30, bottom: 50, left: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    name="Time"
                    domain={[0, 'auto']}
                    stroke="#888"
                    tick={{ fill: '#888' }}
                    label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                  />
                  <YAxis
                    dataKey="y"
                    type="number"
                    name="Total"
                    domain={[0, 'auto']}
                    stroke="#888"
                    tick={{ fill: '#888' }}
                    label={{ value: 'Total Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter
                    name="Left Button"
                    data={chartData.filter((d) => d.buttonClicked === 'left').map(d => ({ x: d.timeElapsed, y: d.total }))}
                    fill="#5ccc96"
                  />
                  <Scatter
                    name="Middle Button"
                    data={chartData.filter((d) => d.buttonClicked === 'middle').map(d => ({ x: d.timeElapsed, y: d.total }))}
                    fill="#e39400"
                  />
                  <Scatter
                    name="Right Button"
                    data={chartData.filter((d) => d.buttonClicked === 'right').map(d => ({ x: d.timeElapsed, y: d.total }))}
                    fill="#00a3cc"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Money Accumulation</CardTitle>
              <CardDescription>Money earned over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 20, right: 30, bottom: 50, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis
                    dataKey="timeElapsed"
                    stroke="#888"
                    tick={{ fill: '#888' }}
                    label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                  />
                  <YAxis
                    stroke="#888"
                    tick={{ fill: '#888' }}
                    tickFormatter={(value: number) => `$${(value / 100).toFixed(0)}`}
                    label={{ value: 'Money Earned', angle: -90, position: 'insideLeft', offset: -15, fill: '#888' }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: number) => [formatMoney(value), 'Money']}
                  />
                  <Line type="monotone" dataKey="money" stroke="#b3a1e6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}
