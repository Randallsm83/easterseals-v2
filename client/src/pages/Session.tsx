import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/useSessionStore';
import { api } from '../lib/api';
import type { ButtonPosition } from '../types';
import { cn } from '../lib/utils';

export function Session() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    config,
    setConfig,
    pointsCounter,
    clickCounts,
    limitReached,
    sessionActive,
    incrementClick,
    awardPoints,
    setLimitReached,
    startSession,
    endSession,
  } = useSessionStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clickIntervalCounter, setClickIntervalCounter] = useState(0);
  const [sessionMessage, setSessionMessage] = useState('');
  const timerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // handleSessionEnd must be defined before loadSessionConfig since it's called by it
  const handleSessionEnd = useCallback(async () => {
    if (limitReached || !config) return;

    setLimitReached(true);
    endSession();

    const message = config.sessionLengthType === 'points'
      ? 'Max points reached, session ended.'
      : 'Time limit reached. Session ended.';
    setSessionMessage(message);

    // Log session end
    await api.logEvent({
      sessionId: sessionId!,
      event: 'end',
      value: {
        pointsCounter,
        pointsEarnedFinal: pointsCounter,
        limitReached: true,
      },
    });
  }, [config, sessionId, pointsCounter, limitReached, setLimitReached, endSession]);

  const loadSessionConfig = useCallback(async () => {
    try {
      // Fetch session data which includes config
      const sessionData = await api.getSessionData(sessionId!);
      // For new sessions, config will have all required fields
      const sessionConfig = { 
        ...sessionData.sessionConfig, 
        sessionId: sessionId!,
        // Ensure required fields have defaults (shouldn't be needed for new sessions)
        sessionLength: sessionData.sessionConfig.sessionLength ?? 60,
        sessionLengthType: sessionData.sessionConfig.sessionLengthType ?? 'seconds',
        continueAfterLimit: sessionData.sessionConfig.continueAfterLimit ?? false,
        pointsAwarded: sessionData.sessionConfig.pointsAwarded ?? 1,
        clicksNeeded: sessionData.sessionConfig.clicksNeeded ?? 1,
        startingPoints: sessionData.sessionConfig.startingPoints ?? 0,
        leftButton: sessionData.sessionConfig.leftButton ?? { shape: 'rectangle', color: '#3b82f6' },
        middleButton: sessionData.sessionConfig.middleButton ?? { shape: 'rectangle', color: '#22c55e' },
        rightButton: sessionData.sessionConfig.rightButton ?? { shape: 'rectangle', color: '#ef4444' },
      };
      setConfig(sessionConfig);
      setLoading(false);

      // Log session start
      await api.logEvent({
        sessionId: sessionId!,
        event: 'start',
        value: {
          pointsCounter: sessionConfig.startingPoints,
          limitReached: false,
        },
      });

      startSession();

      // Setup timer if session is time-based
      if (sessionConfig.sessionLengthType === 'seconds') {
        timerIdRef.current = setTimeout(() => {
          handleSessionEnd();
        }, sessionConfig.sessionLength * 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    }
  }, [sessionId, setConfig, startSession, handleSessionEnd]);

  useEffect(() => {
    if (!sessionId) {
      navigate('/');
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: load config on mount
    loadSessionConfig();

    return () => {
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
      }
    };
  }, [sessionId, navigate, loadSessionConfig]);

  const handleButtonClick = async (button: ButtonPosition) => {
    if (!config || (!sessionActive && !config.continueAfterLimit)) return;

    incrementClick(button);
    const newClickCounts = {
      ...clickCounts,
      total: clickCounts.total + 1,
      [button]: clickCounts[button] + 1,
    };

    let awarded = 0;
    let newInterval = clickIntervalCounter;

    // Check if this was the active button
    if (button === config.buttonActive) {
      newInterval++;

      if (newInterval >= config.clicksNeeded) {
        newInterval = 0;
        awarded = config.pointsAwarded;
        
        if (!limitReached) {
          awardPoints(config.pointsAwarded);

          // Check if we've reached the point limit
          if (
            config.sessionLengthType === 'points' &&
            pointsCounter + config.pointsAwarded >= config.sessionLength
          ) {
            const excess = (pointsCounter + config.pointsAwarded) - config.sessionLength;
            awarded = config.pointsAwarded - excess;
            await handleSessionEnd();
          }
        }
      }
    }

    setClickIntervalCounter(newInterval);

    // Log the click
    await api.logEvent({
      sessionId: sessionId!,
      event: 'click',
      value: {
        buttonClicked: button,
        total: newClickCounts.total,
        left: newClickCounts.left,
        middle: newClickCounts.middle,
        right: newClickCounts.right,
        awardedPoints: awarded,
        pointsCounter: pointsCounter + awarded,
        limitReached,
      },
    });
  };

  const getButtonStyle = (position: ButtonPosition) => {
    if (!config) return {};
    const buttonConfig = config[`${position}Button`];
    
    const baseStyle: React.CSSProperties = {
      backgroundColor: buttonConfig.color,
    };

    switch (buttonConfig.shape) {
      case 'circle':
        return { ...baseStyle, width: '120px', height: '120px', borderRadius: '50%' };
      case 'square':
        return { ...baseStyle, width: '120px', height: '120px', borderRadius: '8px' };
      case 'rectangle':
        return { ...baseStyle, width: '160px', height: '80px', borderRadius: '8px' };
      default:
        return baseStyle;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <p className="text-destructive">{error || 'Session not found'}</p>
        <button
          onClick={() => navigate('/')}
          className="text-primary hover:underline"
        >
          Return to Home
        </button>
      </div>
    );
  }

  const isDisabled = !sessionActive && !config.continueAfterLimit;

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-12">
      {/* Points Display */}
      <div className="text-center">
        <div className="text-8xl font-bold text-primary animate-in">
          {pointsCounter}
        </div>
        <p className="text-muted-foreground mt-2">Points</p>
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-center gap-24">
        {(['left', 'middle', 'right'] as ButtonPosition[]).map((position) => (
          <button
            key={position}
            onClick={() => handleButtonClick(position)}
            disabled={isDisabled}
            style={getButtonStyle(position)}
            className={cn(
              'text-white font-semibold shadow-lg transition-all',
              'hover:scale-110 active:scale-95',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
              'focus:outline-none focus:ring-4 focus:ring-primary/50'
            )}
          >
            Click
          </button>
        ))}
      </div>

      {/* Session Message */}
      {sessionMessage && (
        <div className="bg-accent/20 border border-accent text-accent-foreground px-6 py-3 rounded-lg animate-in">
          {sessionMessage}
        </div>
      )}

      {/* Session Info */}
      <div className="text-center text-sm text-muted-foreground space-y-1">
        <p>Session ID: {config.sessionId}</p>
        <p>Total Clicks: {clickCounts.total}</p>
        <p>
          Active Button: <span className="capitalize">{config.buttonActive}</span>
          {' '} | Clicks for reward: {clickIntervalCounter}/{config.clicksNeeded}
        </p>
      </div>
    </div>
  );
}
