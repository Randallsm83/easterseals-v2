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
import type { SessionDataResponse, SessionListItem, ChartDataPoint, ButtonPosition, Participant, ButtonShape } from '../types';
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

// Helper to get button color from session config (handles new and legacy formats)
function getButtonColor(config: SessionDataResponse['sessionConfig'], position: 'left' | 'middle' | 'right'): string {
  // Fallback colors if none found
  const fallbackColors = { left: '#5ccc96', middle: '#e39400', right: '#00a3cc' };
  
  // Try new format first (leftButton.color)
  const buttonKey = `${position}Button` as 'leftButton' | 'middleButton' | 'rightButton';
  if (config[buttonKey]?.color) {
    return config[buttonKey]!.color;
  }
  
  // Try legacy format (leftButtonColor)
  const legacyKey = `${position}ButtonColor` as 'leftButtonColor' | 'middleButtonColor' | 'rightButtonColor';
  if (config[legacyKey]) {
    return config[legacyKey]!;
  }
  
  return fallbackColors[position];
}

// Helper to get button shape from session config (handles new and legacy formats)
function getButtonShape(config: SessionDataResponse['sessionConfig'], position: 'left' | 'middle' | 'right'): ButtonShape {
  // Try new format first (leftButton.shape)
  const buttonKey = `${position}Button` as 'leftButton' | 'middleButton' | 'rightButton';
  if (config[buttonKey]?.shape) {
    return config[buttonKey]!.shape as ButtonShape;
  }
  
  // Try legacy format (leftButtonShape)
  const legacyKey = `${position}ButtonShape` as 'leftButtonShape' | 'middleButtonShape' | 'rightButtonShape';
  if (config[legacyKey]) {
    return config[legacyKey] as ButtonShape;
  }
  
  return 'rectangle';
}

// SVG shape preview component
function ShapePreview({ shape, color, size = 24 }: { shape: ButtonShape; color: string; size?: number }) {
  if (shape === 'none') {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {shape === 'circle' && (
        <circle cx="12" cy="12" r="10" fill={color} />
      )}
      {shape === 'square' && (
        <rect x="2" y="2" width="20" height="20" fill={color} />
      )}
      {shape === 'rectangle' && (
        <rect x="1" y="5" width="22" height="14" fill={color} />
      )}
    </svg>
  );
}

// Convert hex color to rgba for background
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
        // sessionInfo may have moneyCounter (old) or pointsCounter (new/normalized)
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
          {clickStats && (() => {
            const leftColor = getButtonColor(sessionData.sessionConfig, 'left');
            const middleColor = getButtonColor(sessionData.sessionConfig, 'middle');
            const rightColor = getButtonColor(sessionData.sessionConfig, 'right');
            const leftShape = getButtonShape(sessionData.sessionConfig, 'left');
            const middleShape = getButtonShape(sessionData.sessionConfig, 'middle');
            const rightShape = getButtonShape(sessionData.sessionConfig, 'right');
            
            return (
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
                        style={{ backgroundColor: hexToRgba(leftColor, 0.1), border: `2px solid ${leftColor}` }}
                      >
                        <div className="flex justify-center mb-3">
                          <ShapePreview shape={leftShape} color={leftColor} size={48} />
                        </div>
                        <div className="text-6xl font-bold mb-3" style={{ color: leftColor }}>
                          {clickStats.left.totalClicks}
                        </div>
                        <div className="text-sm font-semibold mb-4" style={{ color: leftColor }}>Left Button</div>
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
                        style={{ backgroundColor: hexToRgba(middleColor, 0.1), border: `2px solid ${middleColor}` }}
                      >
                        <div className="flex justify-center mb-3">
                          <ShapePreview shape={middleShape} color={middleColor} size={48} />
                        </div>
                        <div className="text-6xl font-bold mb-3" style={{ color: middleColor }}>
                          {clickStats.middle.totalClicks}
                        </div>
                        <div className="text-sm font-semibold mb-4" style={{ color: middleColor }}>Middle Button</div>
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
                        style={{ backgroundColor: hexToRgba(rightColor, 0.1), border: `2px solid ${rightColor}` }}
                      >
                        <div className="flex justify-center mb-3">
                          <ShapePreview shape={rightShape} color={rightColor} size={48} />
                        </div>
                        <div className="text-6xl font-bold mb-3" style={{ color: rightColor }}>
                          {clickStats.right.totalClicks}
                        </div>
                        <div className="text-sm font-semibold mb-4" style={{ color: rightColor }}>Right Button</div>
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
            );
          })()}

          {/* Charts - use fixed high-contrast palette for readability */}
          {(() => {
            const CHART_COLORS = { left: '#5ccc96', middle: '#e39400', right: '#00a3cc' };
            
            return (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Click Timeline - Individual Buttons</CardTitle>
                    <CardDescription>
                      Cumulative clicks per button over time
                      <span className="ml-6 inline-flex gap-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS.left }} />
                          Left
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS.middle }} />
                          Middle
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS.right }} />
                          Right
                        </span>
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <ScatterChart margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                        <XAxis
                          dataKey="x"
                          type="number"
                          name="Time"
                          domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                          stroke="#888"
                          tick={{ fill: '#888' }}
                          allowDecimals={false}
                          label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                        />
                        <YAxis
                          dataKey="y"
                          type="number"
                          name="Clicks"
                          domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
                          stroke="#888"
                          tick={{ fill: '#888' }}
                          allowDecimals={false}
                          label={{ value: 'Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                        />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                          labelStyle={{ color: '#fff' }}
                          formatter={(value: number, name: string) => [value, name]}
                          labelFormatter={(value: number) => `Time: ${value.toFixed(1)}s`}
                        />
                        <Scatter
                          name="Left Button"
                          data={chartData.filter((d) => d.buttonClicked === 'left').map(d => ({ x: d.timeElapsed, y: d.left }))}
                          fill={CHART_COLORS.left}
                        />
                        <Scatter
                          name="Middle Button"
                          data={chartData.filter((d) => d.buttonClicked === 'middle').map(d => ({ x: d.timeElapsed, y: d.middle }))}
                          fill={CHART_COLORS.middle}
                        />
                        <Scatter
                          name="Right Button"
                          data={chartData.filter((d) => d.buttonClicked === 'right').map(d => ({ x: d.timeElapsed, y: d.right }))}
                          fill={CHART_COLORS.right}
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
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS.left }} />
                          Left
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS.middle }} />
                          Middle
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS.right }} />
                          Right
                        </span>
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <ScatterChart margin={{ top: 10, right: 30, bottom: 50, left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                        <XAxis
                          dataKey="x"
                          type="number"
                          name="Time"
                          domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                          stroke="#888"
                          tick={{ fill: '#888' }}
                          allowDecimals={false}
                          label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                        />
                        <YAxis
                          dataKey="y"
                          type="number"
                          name="Total"
                          domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
                          stroke="#888"
                          tick={{ fill: '#888' }}
                          allowDecimals={false}
                          label={{ value: 'Total Clicks', angle: -90, position: 'insideLeft', offset: -10, fill: '#888' }}
                        />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                          labelStyle={{ color: '#fff' }}
                          formatter={(value: number, name: string) => [value, name]}
                          labelFormatter={(value: number) => `Time: ${value.toFixed(1)}s`}
                        />
                        <Scatter
                          name="Left Button"
                          data={chartData.filter((d) => d.buttonClicked === 'left').map(d => ({ x: d.timeElapsed, y: d.total }))}
                          fill={CHART_COLORS.left}
                        />
                        <Scatter
                          name="Middle Button"
                          data={chartData.filter((d) => d.buttonClicked === 'middle').map(d => ({ x: d.timeElapsed, y: d.total }))}
                          fill={CHART_COLORS.middle}
                        />
                        <Scatter
                          name="Right Button"
                          data={chartData.filter((d) => d.buttonClicked === 'right').map(d => ({ x: d.timeElapsed, y: d.total }))}
                          fill={CHART_COLORS.right}
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
                // Smart Y-axis: pad 10% around data range, snap to nice cent values
                const range = maxMoney - minMoney;
                const padding = range > 0 ? Math.ceil(range * 0.1) : Math.max(Math.ceil(maxMoney * 0.1), 50);
                const yMin = Math.max(0, minMoney - padding);
                const yMax = maxMoney + padding;
                return (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData} margin={{ top: 20, right: 30, bottom: 50, left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                      <XAxis
                        dataKey="timeElapsed"
                        type="number"
                        domain={[0, (dataMax: number) => Math.ceil(dataMax)]}
                        stroke="#888"
                        tick={{ fill: '#888' }}
                        allowDecimals={false}
                        label={{ value: 'Time (seconds)', position: 'bottom', offset: 20, fill: '#888' }}
                      />
                      <YAxis
                        dataKey="money"
                        domain={[yMin, yMax]}
                        stroke="#888"
                        tick={{ fill: '#888' }}
                        tickFormatter={(value: number) => `$${(value / 100).toFixed(2)}`}
                        label={{ value: 'Money Earned', angle: -90, position: 'insideLeft', offset: -15, fill: '#888' }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
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

        </>
      )}
    </div>
  );
}
