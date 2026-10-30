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
    sessionActive,
    incrementClick,
    incrementInterval,
    getRewardTarget,
    resetInterval,
    bankReward,
    consumePendingReward,
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
  const endingRef = useRef(false);
  const writeFailedRef = useRef(false);
  const pendingWritesRef = useRef<Promise<boolean> | null>(null);

  const [lastActivatedInput, setLastActivatedInput] = useState<string | null>(null);
  const lastActivatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wall-clock ms of the most recent activation, per inputId. A reward on input X is
  // only delivered once every OTHER input has been quiet for changeoverDelayMs.
  const lastActivationAtRef = useRef<Record<string, number>>({});

  // ---- Pause state ----
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [pauseRemainingSec, setPauseRemainingSec] = useState<number | null>(null);
  // Qualifying responses counted since the last pause/start.
  const responseCountSincePauseRef = useRef(0);
  // Absolute timestamp (ms) when the time-limit will fire; used to compute remaining time on pause.
  const timeLimitEndAtRef = useRef<number | null>(null);
  // Remaining ms on the time-limit while currently paused.
  const timeLimitRemainingMsRef = useRef<number | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);


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

  const clearSessionTimers = useCallback(() => {
    clearTimeout(timerIdRef.current ?? undefined);
    clearTimeout(pauseTimerRef.current ?? undefined);
    clearInterval(pauseCountdownRef.current ?? undefined);
    clearTimeout(lastActivatedTimerRef.current ?? undefined);
  }, []);

  const stopSessionActivity = useCallback(() => {
    if (useSessionStore.getState().config?.sessionId === sessionId) endSession();
    clearSessionTimers();
    timerIdRef.current = null;
    pauseTimerRef.current = null;
    pauseCountdownRef.current = null;
    lastActivatedTimerRef.current = null;
    timeLimitEndAtRef.current = null;
    timeLimitRemainingMsRef.current = null;
    isPausedRef.current = false;
    setIsPaused(false);
    setPauseRemainingSec(null);
    setLastActivatedInput(null);
  }, [endSession, sessionId, clearSessionTimers]);

  const failSession = useCallback((cause: unknown) => {
    if (writeFailedRef.current) return;
    writeFailedRef.current = true;
    endingRef.current = true;
    stopSessionActivity();
    setSessionMessage('');
    const message = cause instanceof Error ? cause.message : 'Request failed';
    setError(`Session stopped because data could not be saved. ${message}`);
  }, [stopSessionActivity]);

  const logSessionEvent = useCallback((data: Parameters<typeof api.logEvent>[0]) => {
    const event = { ...data, timestamp: data.timestamp ?? new Date().toISOString() };
    // Equal-millisecond events must reach SQLite in acceptance order.
    const write = (pendingWritesRef.current ?? Promise.resolve(true)).then(async (previousSaved) => {
      if (!previousSaved) return false;
      try {
        await api.logEvent(event);
        return true;
      } catch (cause) {
        failSession(cause);
        return false;
      }
    });
    pendingWritesRef.current = write;
    return write;
  }, [failSession]);

  const finishSession = useCallback(async (reason: 'time' | 'money') => {
    if (endingRef.current || useSessionStore.getState().config?.sessionId !== sessionId) return;
    endingRef.current = true;
    const timestamp = new Date().toISOString();
    if (reason === 'time') setTimeLimitReached(true);
    stopSessionActivity();
    setSessionMessage('Saving session...');

    // Capture final state before navigation can reset the store during the write drain.
    const latest = useSessionStore.getState();
    await pendingWritesRef.current;
    if (writeFailedRef.current) return;

    try {
      await api.endSession(sessionId!, {
        moneyCounter: latest.moneyCounter,
        moneyLimitReached: latest.moneyLimitReached,
        timeLimitReached: latest.timeLimitReached,
        clicks: latest.inputClickCounts,
        totalClicks: latest.totalClicks,
        pendingRewards: latest.pendingRewards,
      }, timestamp);
      setSessionMessage(reason === 'time'
        ? 'Time limit reached. Session ended.'
        : 'Money limit reached. Session ended.');
    } catch (cause) {
      failSession(cause);
    }
  }, [sessionId, setTimeLimitReached, stopSessionActivity, failSession]);

  const handleTimeLimitEnd = useCallback(() => finishSession('time'), [finishSession]);

  // Keep latest handler in a ref so scheduleTimeLimit can call it without re-creating itself.
  const handleTimeLimitEndRef = useRef(handleTimeLimitEnd);
  useEffect(() => { handleTimeLimitEndRef.current = handleTimeLimitEnd; }, [handleTimeLimitEnd]);

  // Schedule the time-limit end-of-session timer with the given remaining ms.
  const scheduleTimeLimit = useCallback((remainingMs: number) => {
    if (timerIdRef.current) {
      clearTimeout(timerIdRef.current);
      timerIdRef.current = null;
    }
    timeLimitEndAtRef.current = Date.now() + remainingMs;
    timerIdRef.current = setTimeout(() => {
      handleTimeLimitEndRef.current();
    }, remainingMs);
  }, []);


  // ---- Resume from pause ----
  const resumeSession = useCallback(() => {
    if (!isPausedRef.current || endingRef.current) return;

    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (pauseCountdownRef.current) {
      clearInterval(pauseCountdownRef.current);
      pauseCountdownRef.current = null;
    }

    isPausedRef.current = false;
    setIsPaused(false);
    setPauseRemainingSec(null);
    responseCountSincePauseRef.current = 0;

    // Resume the time-limit countdown from the stored remaining ms
    if (timeLimitRemainingMsRef.current !== null && timeLimitRemainingMsRef.current > 0) {
      scheduleTimeLimit(timeLimitRemainingMsRef.current);
    }
    timeLimitRemainingMsRef.current = null;

    const latest = useSessionStore.getState();
    void logSessionEvent({
      sessionId: sessionId!,
      event: 'resume',
      value: {
        moneyCounter: latest.moneyCounter,
        totalClicks: latest.totalClicks,
      },
    });
  }, [sessionId, scheduleTimeLimit, logSessionEvent]);

  // Timers always invoke the latest resume handler.
  const resumeSessionRef = useRef(resumeSession);
  useEffect(() => { resumeSessionRef.current = resumeSession; }, [resumeSession]);

  // ---- Enter pause ----
  const pauseSession = useCallback(() => {
    if (isPausedRef.current || endingRef.current || !sessionId || !config) return;

    // Snapshot remaining time on the time-limit so we can resume later
    if (timeLimitEndAtRef.current !== null) {
      timeLimitRemainingMsRef.current = Math.max(0, timeLimitEndAtRef.current - Date.now());
    }
    if (timerIdRef.current) {
      clearTimeout(timerIdRef.current);
      timerIdRef.current = null;
    }

    isPausedRef.current = true;
    setIsPaused(true);
    responseCountSincePauseRef.current = 0;

    const latest = useSessionStore.getState();
    void logSessionEvent({
      sessionId,
      event: 'pause',
      value: {
        moneyCounter: latest.moneyCounter,
        totalClicks: latest.totalClicks,
      },
    });

    const durationSec = config.pauseDurationSeconds ?? 15;

    if ((config.pauseResumeMode ?? 'auto') === 'auto') {
      setPauseRemainingSec(durationSec);
      pauseTimerRef.current = setTimeout(() => {
        resumeSessionRef.current();
      }, durationSec * 1000);
      pauseCountdownRef.current = setInterval(() => {
        setPauseRemainingSec((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
      }, 1000);
    } else {
      setPauseRemainingSec(null);
    }
  }, [config, sessionId, logSessionEvent]);

  // Latest pauseSession callback (so handleInputActivation can call it without re-binding).
  const pauseSessionRef = useRef(pauseSession);
  useEffect(() => { pauseSessionRef.current = pauseSession; }, [pauseSession]);

  const loadSessionConfig = useCallback(async () => {
    if (sessionInitializedRef.current) return;
    sessionInitializedRef.current = true;

    try {
      const sessionData = await api.getSessionData(sessionId!);
      const raw = sessionData.sessionConfig;
      const sessionConfig = normalizeSessionConfig(raw, sessionId!, raw.configId ?? '');

      setConfig(sessionConfig);
      setLoading(false);

      const saved = await logSessionEvent({
        sessionId: sessionId!,
        event: 'start',
        value: {
          moneyCounter: sessionConfig.startingMoney,
          moneyLimitReached: false,
          timeLimitReached: false,
        },
      });
      if (!saved) return;

      lastActivationAtRef.current = {};
      startSession();
      scheduleTimeLimit(sessionConfig.timeLimit * 1000);
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
    return clearSessionTimers;
  }, [sessionId, navigate, loadSessionConfig, clearSessionTimers]);

  // Pays out one reward for `inputConfig`, clamped to the session money limit, and
  // returns the cents actually awarded.
  const deliverReward = useCallback((inputConfig: InputConfig): number => {
    if (!config) return 0;
    const current = useSessionStore.getState().moneyCounter;
    const awardedCents = Math.min(inputConfig.moneyAwarded, Math.max(0, config.moneyLimit - current));
    awardMoney(awardedCents);
    if (current + awardedCents >= config.moneyLimit) setMoneyLimitReached(true);
    if (inputConfig.playAwardSound) playAwardSound();
    return awardedCents;
  }, [config, awardMoney, setMoneyLimitReached, playAwardSound]);

  // Unified click handler — works for both screen buttons and physical inputs
  const handleInputActivation = useCallback((inputId: string) => {
    if (!config) return;
    if (isPausedRef.current || endingRef.current || !useSessionStore.getState().sessionActive) return;

    const inputConfig = config.inputs.find(i => i.id === inputId);
    if (!inputConfig) return;

    const nowMs = Date.now();
    const codEnabled = config.changeoverDelayEnabled === true;
    const codMs = config.changeoverDelayMs ?? 1000;
    let codSatisfied = true;
    if (codEnabled) {
      let lastOther = -Infinity;
      for (const [id, at] of Object.entries(lastActivationAtRef.current)) {
        if (id !== inputId && at > lastOther) lastOther = at;
      }
      codSatisfied = lastOther === -Infinity || nowMs - lastOther >= codMs;
    }
    lastActivationAtRef.current[inputId] = nowMs;

    incrementClick(inputId);

    // Visual flash
    setLastActivatedInput(inputId);
    clearTimeout(lastActivatedTimerRef.current ?? undefined);
    lastActivatedTimerRef.current = setTimeout(() => setLastActivatedInput(null), 200);

    let awardedCents = 0;
    let codWithheld = false;

    if (inputConfig.isRewarded && !useSessionStore.getState().moneyLimitReached) {
      // Pay out a previously withheld reward first, once the changeover delay is clear.
      if (codSatisfied && consumePendingReward(inputId)) {
        awardedCents = deliverReward(inputConfig);
      }

      const newInterval = incrementInterval(inputId);
      const rewardTarget = getRewardTarget(inputId);

      if (newInterval >= rewardTarget) {
        resetInterval(inputId);
        if (!codEnabled || (codSatisfied && awardedCents === 0)) {
          awardedCents = deliverReward(inputConfig);
        } else {
          // Either the changeover delay is not met, or one reward already went out on
          // this response. Bank it; it pays on the next clear response on this input.
          bankReward(inputId);
          codWithheld = true;
        }
      }
    }

    const latest = useSessionStore.getState();
    void logSessionEvent({
      sessionId: sessionId!,
      event: 'click',
      value: {
        inputId,
        inputName: inputConfig.name,
        inputType: inputConfig.type,
        clicks: latest.inputClickCounts,
        totalClicks: latest.totalClicks,
        awardedCents,
        moneyCounter: latest.moneyCounter,
        moneyLimitReached: latest.moneyLimitReached,
        timeLimitReached: latest.timeLimitReached,
        codWithheld,
        codPending: latest.pendingRewards[inputId] ?? 0,
      },
    });

    if (latest.moneyLimitReached && !config.continueAfterMoneyLimit) {
      void finishSession('money');
    }

    // Pause trigger: count this response toward the configured threshold
    if (config.pauseEnabled && !latest.moneyLimitReached && !latest.timeLimitReached) {
      const trigger = config.pauseTrigger ?? 'rewarded';
      const qualifies = trigger === 'any' || (trigger === 'rewarded' && awardedCents > 0);
      if (qualifies) {
        responseCountSincePauseRef.current += 1;
        if (responseCountSincePauseRef.current >= (config.pauseAfterResponses ?? 5)) {
          pauseSessionRef.current();
        }
      }
    }
  }, [config, sessionId, logSessionEvent, finishSession,
    incrementClick, incrementInterval, getRewardTarget, resetInterval, deliverReward, bankReward, consumePendingReward]);

  // Physical inputs for the external input hook
  const physicalInputs = config?.inputs.filter(i => i.type !== 'screen') ?? [];

  useExternalInput({
    inputs: physicalInputs,
    onInput: handleInputActivation,
    enabled: !isPaused && sessionActive,
  });

  // ---- Manual-resume listener while paused ----
  useEffect(() => {
    if (!isPaused) return;
    if (!config || (config.pauseResumeMode ?? 'auto') !== 'manual') return;

    const binding = config.pauseResumeBinding ?? { type: 'any' as const };

    // Guard against double-fire
    let fired = false;
    const resumeOnce = () => {
      if (fired) return;
      fired = true;
      resumeSession();
    };

    // Keyboard listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (binding.type === 'any') {
        e.preventDefault();
        resumeOnce();
        return;
      }
      if (binding.type === 'keyboard' && binding.inputCode === e.code) {
        e.preventDefault();
        resumeOnce();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Gamepad polling
    let rafId: number | null = null;
    // Baseline so currently-held inputs don't instantly resume
    const prev: Record<string, boolean> = {};
    const gpsNow = navigator.getGamepads?.() ?? [];
    for (let gpIndex = 0; gpIndex < gpsNow.length; gpIndex++) {
      const gp = gpsNow[gpIndex];
      if (!gp) continue;
      for (let i = 0; i < gp.buttons.length; i++) {
        prev[`gp-${gpIndex}-btn-${i}`] = gp.buttons[i].pressed;
      }
      for (let i = 0; i < gp.axes.length; i++) {
        prev[`gp-${gpIndex}-axis-${i}-pos`] = gp.axes[i] > 0.5;
        prev[`gp-${gpIndex}-axis-${i}-neg`] = gp.axes[i] < -0.5;
      }
    }

    const poll = () => {
      const gps = navigator.getGamepads?.() ?? [];
      for (let gpIndex = 0; gpIndex < gps.length; gpIndex++) {
        const gp = gps[gpIndex];
        if (!gp) continue;

        // Buttons
        for (let i = 0; i < gp.buttons.length; i++) {
          const key = `gp-${gpIndex}-btn-${i}`;
          const pressed = gp.buttons[i].pressed;
          if (pressed && !prev[key]) {
            if (binding.type === 'any' || (binding.type === 'gamepad_button' && binding.inputCode === key)) {
              resumeOnce();
            }
          }
          prev[key] = pressed;
        }

        // Axes
        for (let i = 0; i < gp.axes.length; i++) {
          const v = gp.axes[i];
          const posKey = `gp-${gpIndex}-axis-${i}-pos`;
          const negKey = `gp-${gpIndex}-axis-${i}-neg`;
          const isPos = v > 0.5;
          const isNeg = v < -0.5;
          if (isPos && !prev[posKey]) {
            if (binding.type === 'any' || (binding.type === 'gamepad_axis' && binding.inputCode === posKey)) {
              resumeOnce();
            }
          }
          if (isNeg && !prev[negKey]) {
            if (binding.type === 'any' || (binding.type === 'gamepad_axis' && binding.inputCode === negKey)) {
              resumeOnce();
            }
          }
          prev[posKey] = isPos;
          prev[negKey] = isNeg;
        }
      }
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isPaused, config, resumeSession]);

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

  const isDisabled = isPaused || !sessionActive;
  const screenInputs = config.inputs.filter(i => i.type === 'screen' && i.shape !== 'none');
  const showMoney = config.showMoneyToParticipant !== false;

  // Manual-resume overlay text
  const resumeBinding = config.pauseResumeBinding ?? { type: 'any' as const };
  const resumeBindingLabel =
    resumeBinding.type === 'any'
      ? 'any key or button'
      : resumeBinding.inputLabel ?? 'the assigned input';

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-20 relative">
      {/* Money Display (hidden when configured for participant) */}
      {showMoney && (
        <div className="text-center">
          <div className="text-7xl font-bold text-primary animate-in">
            {formatMoney(moneyCounter)} / {formatMoney(config.moneyLimit)}
          </div>
        </div>
      )}

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

      {/* Session Message */}
      {sessionMessage && (
        <div className="bg-accent/20 border border-accent text-accent-foreground px-6 py-3 rounded-lg animate-in">
          {sessionMessage}
        </div>
      )}

      {/* Pause overlay */}
      {isPaused && (
        <div className="fixed inset-0 z-40 bg-background/85 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-card border rounded-lg p-10 text-center space-y-4 max-w-md">
            <div className="text-6xl">⏸️</div>
            <h2 className="text-3xl font-bold">Paused</h2>
            {(config.pauseResumeMode ?? 'auto') === 'auto' ? (
              <p className="text-xl text-muted-foreground">
                Resuming in <span className="font-bold text-primary">{pauseRemainingSec ?? 0}</span>s
              </p>
            ) : (
              <p className="text-xl text-muted-foreground">
                Press <span className="font-bold text-primary">{resumeBindingLabel}</span> to resume
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
