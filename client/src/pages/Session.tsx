import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/useSessionStore';
import { api } from '../lib/api';
import type { ButtonPosition } from '../types';
import { cn } from '../lib/utils';

// Format cents as dollars
function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Session() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    config,
    setConfig,
    moneyCounter,
    clickCounts,
    moneyLimitReached,
    timeLimitReached,
    sessionActive,
    incrementClick,
    awardMoney,
    setMoneyLimitReached,
    setTimeLimitReached,
    startSession,
    endSession,
  } = useSessionStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awardIntervalCounter, setAwardIntervalCounter] = useState(0);
  const [sessionMessage, setSessionMessage] = useState('');
  const timerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio('/sounds/money.mp3');
    return () => {
      audioRef.current = null;
    };
  }, []);

  const playAwardSound = useCallback(() => {
    if (config?.playAwardSound && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Ignore audio play errors (e.g., user hasn't interacted with page yet)
      });
    }
  }, [config?.playAwardSound]);

  // Handle time limit reached
  const handleTimeLimitEnd = useCallback(async () => {
    if (timeLimitReached || !config) return;

    setTimeLimitReached(true);
    endSession();
    setSessionMessage('Time limit reached. Session ended.');

    // Log session end
    await api.logEvent({
      sessionId: sessionId!,
      event: 'end',
      value: {
        moneyCounter,
        moneyLimitReached,
        timeLimitReached: true,
        clicks: clickCounts,
      },
    });
  }, [config, sessionId, moneyCounter, moneyLimitReached, timeLimitReached, clickCounts, setTimeLimitReached, endSession]);

  // Handle money limit reached
  const handleMoneyLimitEnd = useCallback(async () => {
    if (moneyLimitReached || !config) return;

    setMoneyLimitReached(true);
    
    if (!config.continueAfterMoneyLimit) {
      endSession();
      setSessionMessage('Money limit reached. Session ended.');

      // Log session end
      await api.logEvent({
        sessionId: sessionId!,
        event: 'end',
        value: {
          moneyCounter,
          moneyLimitReached: true,
          timeLimitReached,
          clicks: clickCounts,
        },
      });
    }
  }, [config, sessionId, moneyCounter, timeLimitReached, moneyLimitReached, clickCounts, setMoneyLimitReached, endSession]);

  const loadSessionConfig = useCallback(async () => {
    try {
      const sessionData = await api.getSessionData(sessionId!);
      const cfg = sessionData.sessionConfig;
      
      const sessionConfig = { 
        ...cfg, 
        sessionId: sessionId!,
        configId: cfg.configId ?? '',
        timeLimit: cfg.timeLimit ?? 60,
        moneyAwarded: cfg.moneyAwarded ?? 5,
        moneyLimit: cfg.moneyLimit ?? 1000000,
        startingMoney: cfg.startingMoney ?? 0,
        awardInterval: cfg.awardInterval ?? 10,
        playAwardSound: cfg.playAwardSound ?? true,
        continueAfterMoneyLimit: cfg.continueAfterMoneyLimit ?? true,
        leftButton: cfg.leftButton ?? { shape: 'circle', color: '#5ccc96' },
        middleButton: cfg.middleButton ?? { shape: 'square', color: '#e39400' },
        rightButton: cfg.rightButton ?? { shape: 'circle', color: '#00a3cc' },
      };
      
      setConfig(sessionConfig);
      setLoading(false);

      // Log session start
      await api.logEvent({
        sessionId: sessionId!,
        event: 'start',
        value: {
          moneyCounter: sessionConfig.startingMoney,
          moneyLimitReached: false,
          timeLimitReached: false,
        },
      });

      startSession();

      // Setup time limit timer
      timerIdRef.current = setTimeout(() => {
        handleTimeLimitEnd();
      }, sessionConfig.timeLimit * 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    }
  }, [sessionId, setConfig, startSession, handleTimeLimitEnd]);

  useEffect(() => {
    if (!sessionId) {
      navigate('/');
      return;
    }

    loadSessionConfig();

    return () => {
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
      }
    };
  }, [sessionId, navigate, loadSessionConfig]);

  const handleButtonClick = async (button: ButtonPosition) => {
    if (!config) return;
    // Allow clicks if session active OR if continue after money limit is enabled
    if (!sessionActive && !(config.continueAfterMoneyLimit && moneyLimitReached)) return;

    incrementClick(button);
    const newClickCounts = {
      ...clickCounts,
      total: clickCounts.total + 1,
      [button]: clickCounts[button] + 1,
    };

    let awardedCents = 0;
    let newInterval = awardIntervalCounter;

    // Check if this was the active button
    if (button === config.buttonActive) {
      newInterval++;

      if (newInterval >= config.awardInterval) {
        newInterval = 0;

        if (!moneyLimitReached) {
          const potentialNewTotal = moneyCounter + config.moneyAwarded;
          
          if (potentialNewTotal >= config.moneyLimit) {
            // Award only what's needed to reach the limit
            awardedCents = config.moneyLimit - moneyCounter;
            awardMoney(awardedCents);
            playAwardSound();
            await handleMoneyLimitEnd();
          } else {
            awardedCents = config.moneyAwarded;
            awardMoney(config.moneyAwarded);
            playAwardSound();
          }
        }
      }
    }

    setAwardIntervalCounter(newInterval);

    // Log the click
    await api.logEvent({
      sessionId: sessionId!,
      event: 'click',
      value: {
        buttonClicked: button,
        clicks: newClickCounts,
        awardedCents,
        moneyCounter: moneyCounter + awardedCents,
        moneyLimitReached,
        timeLimitReached,
      },
    });
  };

  const getButtonStyle = (position: ButtonPosition) => {
    if (!config) return {};
    const buttonConfig = config[`${position}Button`];
    if (!buttonConfig) return {};
    
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

  const isDisabled = !sessionActive && !(config.continueAfterMoneyLimit && moneyLimitReached);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-12">
      {/* Money Display */}
      <div className="text-center">
        <div className="text-7xl font-bold text-primary animate-in">
          {formatMoney(moneyCounter)} / {formatMoney(config.moneyLimit)}
        </div>
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
            Click Me
          </button>
        ))}
      </div>

      {/* Session Message */}
      {sessionMessage && (
        <div className="bg-accent/20 border border-accent text-accent-foreground px-6 py-3 rounded-lg animate-in">
          {sessionMessage}
        </div>
      )}

      {/* Session Info - minimal during active session */}
      <div className="text-center text-sm text-muted-foreground space-y-1">
        <p>Total Clicks: {clickCounts.total}</p>
      </div>
    </div>
  );
}
