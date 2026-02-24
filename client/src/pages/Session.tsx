import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/useSessionStore';
import { api } from '../lib/api';
import { normalizeSessionConfig } from '../lib/normalizeConfig';
import { useExternalInput } from '../lib/useExternalInput';
import type { InputConfig } from '../types';
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
    totalClicks,
    inputClickCounts,
    moneyLimitReached,
    timeLimitReached,
    sessionActive,
    incrementClick,
    incrementInterval,
    resetInterval,
    awardMoney,
    setMoneyLimitReached,
    setTimeLimitReached,
    startSession,
    endSession,
  } = useSessionStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState('');
  const timerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionInitializedRef = useRef(false);

  const [lastActivatedInput, setLastActivatedInput] = useState<string | null>(null);
  const lastActivatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for latest state values (needed for setTimeout callback)
  const stateRef = useRef({ moneyCounter, totalClicks, inputClickCounts, moneyLimitReached, timeLimitReached });
  stateRef.current = { moneyCounter, totalClicks, inputClickCounts, moneyLimitReached, timeLimitReached };

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio('/sounds/money.mp3');
    return () => {
      audioRef.current = null;
    };
  }, []);

  const playAwardSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, []);

  // Handle time limit reached
  const handleTimeLimitEnd = useCallback(async () => {
    const { moneyCounter: currentMoney, inputClickCounts: currentClicks, moneyLimitReached: currentMoneyLimit } = stateRef.current;

    if (stateRef.current.timeLimitReached) return;

    setTimeLimitReached(true);
    endSession();
    setSessionMessage('Time limit reached. Session ended.');

    await Promise.all([
      api.logEvent({
        sessionId: sessionId!,
        event: 'end',
        value: {
          moneyCounter: currentMoney,
          moneyLimitReached: currentMoneyLimit,
          timeLimitReached: true,
          clicks: currentClicks,
          totalClicks: stateRef.current.totalClicks,
        },
      }),
      api.endSession(sessionId!),
    ]);
  }, [sessionId, setTimeLimitReached, endSession]);

  // Handle money limit reached
  const handleMoneyLimitEnd = useCallback(async () => {
    if (moneyLimitReached || !config) return;

    setMoneyLimitReached(true);

    if (!config.continueAfterMoneyLimit) {
      endSession();
      setSessionMessage('Money limit reached. Session ended.');

      await Promise.all([
        api.logEvent({
          sessionId: sessionId!,
          event: 'end',
          value: {
            moneyCounter,
            moneyLimitReached: true,
            timeLimitReached,
            clicks: inputClickCounts,
            totalClicks,
          },
        }),
        api.endSession(sessionId!),
      ]);
    }
  }, [config, sessionId, moneyCounter, timeLimitReached, moneyLimitReached, inputClickCounts, totalClicks, setMoneyLimitReached, endSession]);

  const loadSessionConfig = useCallback(async () => {
    if (sessionInitializedRef.current) return;
    sessionInitializedRef.current = true;

    try {
      const sessionData = await api.getSessionData(sessionId!);
      const raw = sessionData.sessionConfig;
      const sessionConfig = normalizeSessionConfig(raw, sessionId!, raw.configId ?? '');

      setConfig(sessionConfig);
      setLoading(false);

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

      timerIdRef.current = setTimeout(() => {
        handleTimeLimitEnd();
      }, sessionConfig.timeLimit * 1000);
    } catch (err) {
      sessionInitializedRef.current = false;
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      navigate('/');
      return;
    }
    loadSessionConfig();
    return () => {
      if (timerIdRef.current) clearTimeout(timerIdRef.current);
    };
  }, [sessionId, navigate, loadSessionConfig]);

  // Unified click handler — works for both screen buttons and physical inputs
  const handleInputActivation = useCallback(async (inputId: string) => {
    if (!config) return;
    if (!sessionActive && !(config.continueAfterMoneyLimit && moneyLimitReached)) return;

    const inputConfig = config.inputs.find(i => i.id === inputId);
    if (!inputConfig) return;

    incrementClick(inputId);

    // Visual flash
    setLastActivatedInput(inputId);
    if (lastActivatedTimerRef.current) clearTimeout(lastActivatedTimerRef.current);
    lastActivatedTimerRef.current = setTimeout(() => setLastActivatedInput(null), 200);

    let awardedCents = 0;

    if (inputConfig.isRewarded && !moneyLimitReached) {
      const newInterval = incrementInterval(inputId);

      if (newInterval >= inputConfig.awardInterval) {
        resetInterval(inputId);

        const potentialNewTotal = moneyCounter + inputConfig.moneyAwarded;

        if (potentialNewTotal >= config.moneyLimit) {
          awardedCents = config.moneyLimit - moneyCounter;
          awardMoney(awardedCents);
          if (inputConfig.playAwardSound) playAwardSound();
          await handleMoneyLimitEnd();
        } else {
          awardedCents = inputConfig.moneyAwarded;
          awardMoney(inputConfig.moneyAwarded);
          if (inputConfig.playAwardSound) playAwardSound();
        }
      }
    }

    // Log the event
    const updatedClicks = {
      ...stateRef.current.inputClickCounts,
      [inputId]: (stateRef.current.inputClickCounts[inputId] ?? 0) + 1,
    };

    await api.logEvent({
      sessionId: sessionId!,
      event: 'click',
      value: {
        inputId,
        inputName: inputConfig.name,
        inputType: inputConfig.type,
        clicks: updatedClicks,
        totalClicks: stateRef.current.totalClicks + 1,
        awardedCents,
        moneyCounter: moneyCounter + awardedCents,
        moneyLimitReached,
        timeLimitReached,
      },
    });
  }, [config, sessionId, sessionActive, moneyCounter, moneyLimitReached, timeLimitReached,
    incrementClick, incrementInterval, resetInterval, awardMoney, playAwardSound, handleMoneyLimitEnd]);

  // External input handler — wraps handleInputActivation for physical inputs
  const handleExternalInput = useCallback(async (inputId: string) => {
    await handleInputActivation(inputId);
  }, [handleInputActivation]);

  // Physical inputs for the external input hook
  const physicalInputs = config?.inputs.filter(i => i.type !== 'screen') ?? [];

  useExternalInput({
    inputs: physicalInputs,
    onInput: handleExternalInput,
    enabled: sessionActive || (config?.continueAfterMoneyLimit === true && moneyLimitReached),
  });

  const getButtonStyle = (input: InputConfig) => {
    const baseStyle: React.CSSProperties = {
      backgroundColor: input.color ?? '#5ccc96',
    };

    switch (input.shape) {
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
  const screenInputs = config.inputs.filter(i => i.type === 'screen' && i.shape !== 'none');

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-20">
      {/* Money Display */}
      <div className="text-center">
        <div className="text-7xl font-bold text-primary animate-in">
          {formatMoney(moneyCounter)} / {formatMoney(config.moneyLimit)}
        </div>
      </div>

      {/* Screen Buttons */}
      <div className="flex items-center justify-center gap-24 mt-8">
        {screenInputs.map((input) => (
          <button
            key={input.id}
            onClick={() => handleInputActivation(input.id)}
            disabled={isDisabled}
            style={getButtonStyle(input)}
            className={cn(
              'text-white font-semibold shadow-lg transition-all',
              'hover:scale-110 active:scale-95',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
              'focus:outline-none focus:ring-4 focus:ring-primary/50',
              lastActivatedInput === input.id && 'scale-110'
            )}
          >
            Click Me
          </button>
        ))}
      </div>

      {/* Physical Input Status */}
      {physicalInputs.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {physicalInputs.map((input) => (
            <div
              key={input.id}
              className={cn(
                'px-4 py-2 rounded-lg border text-sm transition-all',
                lastActivatedInput === input.id
                  ? 'bg-primary/20 border-primary scale-105'
                  : 'bg-muted/30 border-border'
              )}
            >
              <span className="font-medium">{input.name || input.inputLabel}</span>
              <span className="text-muted-foreground ml-2">
                {inputClickCounts[input.id] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Session Message */}
      {sessionMessage && (
        <div className="bg-accent/20 border border-accent text-accent-foreground px-6 py-3 rounded-lg animate-in">
          {sessionMessage}
        </div>
      )}
    </div>
  );
}
