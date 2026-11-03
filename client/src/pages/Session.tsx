import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/useSessionStore';
import { api } from '../lib/api';
import { normalizeSessionConfig } from '../lib/normalizeConfig';
import { useExternalInput } from '../lib/useExternalInput';
import type { InputConfig, SequenceRun, SessionConfig } from '../types';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';

interface SessionScope {
  routeKey: string;
  cancelled: boolean;
}

interface SessionRuntime {
  scope: SessionScope;
  sessionId: string;
  runId?: string;
  position: number;
  pendingWrites: Promise<boolean> | null;
  ending: boolean;
  failed: boolean;
}

// Format cents as dollars
function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Session() {
  const { sessionId: routeSessionId, runId } = useParams<{ sessionId: string; runId: string }>();
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

  const sessionId = config?.sessionId;
  const routeKey = runId ? `run:${runId}` : `session:${routeSessionId ?? ''}`;
  const routeKeyRef = useRef(routeKey);
  routeKeyRef.current = routeKey;
  const runtimeRef = useRef<SessionRuntime | null>(null);
  const frozenConfigsRef = useRef<SessionConfig[]>([]);
  const [sequenceBalance, setSequenceBalance] = useState(0);
  const [sequenceComplete, setSequenceComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState('');
  const timerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [lastActivatedInput, setLastActivatedInput] = useState<string | null>(null);
  const lastActivatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A reward waits until every other input has been quiet for the configured delay.
  const lastActivationAtRef = useRef<Record<string, number>>({});
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [pauseRemainingSec, setPauseRemainingSec] = useState<number | null>(null);
  const responseCountSincePauseRef = useRef(0);
  const timeLimitEndAtRef = useRef<number | null>(null);
  const timeLimitRemainingMsRef = useRef<number | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ownsRuntime = useCallback((runtime: SessionRuntime) =>
    !runtime.scope.cancelled &&
    runtime.scope.routeKey === routeKeyRef.current &&
    runtimeRef.current === runtime &&
    useSessionStore.getState().config?.sessionId === runtime.sessionId,
  []);

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio('/sounds/money.mp3');
    return () => {
      audioRef.current?.pause();
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
    timerIdRef.current = null;
    pauseTimerRef.current = null;
    pauseCountdownRef.current = null;
    lastActivatedTimerRef.current = null;
    timeLimitEndAtRef.current = null;
    timeLimitRemainingMsRef.current = null;
  }, []);

  const stopSessionActivity = useCallback((runtime: SessionRuntime) => {
    if (!ownsRuntime(runtime)) return;
    endSession();
    clearSessionTimers();
    audioRef.current?.pause();
    isPausedRef.current = false;
    responseCountSincePauseRef.current = 0;
    lastActivationAtRef.current = {};
    setIsPaused(false);
    setPauseRemainingSec(null);
    setLastActivatedInput(null);
  }, [endSession, ownsRuntime, clearSessionTimers]);

  const failSession = useCallback((runtime: SessionRuntime, cause: unknown) => {
    if (runtime.failed) return;
    runtime.failed = true;
    runtime.ending = true;
    const message = cause instanceof Error ? cause.message : 'Request failed';
    const stoppedMessage = `${runtime.runId ? 'Sequence' : 'Session'} stopped because data could not be saved. ${message}`;
    if (ownsRuntime(runtime)) {
      stopSessionActivity(runtime);
      setSessionMessage('');
      setError(stoppedMessage);
    }
    if (runtime.runId && !runtime.scope.cancelled) {
      void api.interruptSequenceRun(runtime.runId).then(interrupted => {
        if (!ownsRuntime(runtime)) return;
        setError(`${stoppedMessage} ${interrupted.status === 'interrupted'
          ? 'Run marked interrupted.'
          : interrupted.status === 'completed'
            ? 'Run was already completed.'
            : 'Run could not be marked interrupted.'}`);
      }).catch(interruptionError => {
        if (!ownsRuntime(runtime)) return;
        const detail = interruptionError instanceof Error ? interruptionError.message : 'Request failed';
        setError(`${stoppedMessage} Run could not be marked interrupted. ${detail}`);
      });
    }
  }, [ownsRuntime, stopSessionActivity]);

  const logSessionEvent = useCallback((
    runtime: SessionRuntime,
    data: Omit<Parameters<typeof api.logEvent>[0], 'sessionId'>,
  ) => {
    if (runtime.failed || !ownsRuntime(runtime)) return Promise.resolve(false);
    const event = { ...data, sessionId: runtime.sessionId, timestamp: data.timestamp ?? new Date().toISOString() };
    // Accepted writes keep their owner and order even if navigation replaces the store.
    const write = (runtime.pendingWrites ?? Promise.resolve(true)).then(async previousSaved => {
      if (!previousSaved) return false;
      try {
        await api.logEvent(event);
        return true;
      } catch (cause) {
        failSession(runtime, cause);
        return false;
      }
    });
    runtime.pendingWrites = write;
    return write;
  }, [failSession, ownsRuntime]);

  const handleTimeLimitEndRef = useRef<(() => void) | null>(null);
  const scheduleTimeLimit = useCallback((remainingMs: number, runtime: SessionRuntime) => {
    if (!ownsRuntime(runtime) || runtime.ending || runtime.failed) return;
    clearTimeout(timerIdRef.current ?? undefined);
    timeLimitEndAtRef.current = Date.now() + remainingMs;
    timerIdRef.current = setTimeout(() => {
      if (ownsRuntime(runtime) && !runtime.ending && !runtime.failed) {
        handleTimeLimitEndRef.current?.();
      }
    }, remainingMs);
  }, [ownsRuntime]);

  const activateCondition = useCallback(async (
    scope: SessionScope,
    sessionConfig: SessionConfig,
    sequenceRunId?: string,
    position = 0,
  ) => {
    if (scope.cancelled || scope.routeKey !== routeKeyRef.current) return;
    clearSessionTimers();
    isPausedRef.current = false;
    lastActivationAtRef.current = {};
    responseCountSincePauseRef.current = 0;
    setIsPaused(false);
    setPauseRemainingSec(null);
    setLastActivatedInput(null);
    const runtime: SessionRuntime = {
      scope,
      sessionId: sessionConfig.sessionId,
      runId: sequenceRunId,
      position,
      pendingWrites: null,
      ending: false,
      failed: false,
    };
    runtimeRef.current = runtime;
    setConfig(sessionConfig);
    setLoading(false);
    const saved = await logSessionEvent(runtime, {
      event: 'start',
      value: {
        moneyCounter: sessionConfig.startingMoney,
        moneyLimitReached: false,
        timeLimitReached: false,
      },
    });
    if (!saved || !ownsRuntime(runtime) || runtime.ending) return;
    startSession();
    scheduleTimeLimit(sessionConfig.timeLimit * 1000, runtime);
  }, [clearSessionTimers, setConfig, logSessionEvent, ownsRuntime, startSession, scheduleTimeLimit]);

  const finishSession = useCallback(async (reason: 'time' | 'money') => {
    const runtime = runtimeRef.current;
    if (!runtime || !ownsRuntime(runtime) || runtime.ending || runtime.failed) return;
    runtime.ending = true;
    const timestamp = new Date().toISOString();
    if (reason === 'time') setTimeLimitReached(true);
    stopSessionActivity(runtime);
    if (!runtime.runId) setSessionMessage('Saving session...');

    const latest = useSessionStore.getState();
    await runtime.pendingWrites;
    if (runtime.failed || (runtime.runId && !ownsRuntime(runtime))) return;
    try {
      const result = await api.endSession(runtime.sessionId, {
        moneyCounter: latest.moneyCounter,
        moneyLimitReached: latest.moneyLimitReached,
        timeLimitReached: latest.timeLimitReached,
        clicks: latest.inputClickCounts,
        totalClicks: latest.totalClicks,
        pendingRewards: latest.pendingRewards,
      }, timestamp);
      if (!ownsRuntime(runtime)) return;
      if (!runtime.runId) {
        setSessionMessage(reason === 'time'
          ? 'Time limit reached. Session ended.'
          : 'Money limit reached. Session ended.');
        return;
      }
      const nextRun = result.run;
      if (!nextRun || nextRun.runId !== runtime.runId || nextRun.currentPosition !== runtime.position + 1) {
        throw new Error('The next sequence condition could not be confirmed.');
      }
      setSequenceBalance(nextRun.sequenceBalance);
      if (nextRun.status === 'completed' && nextRun.currentPosition === frozenConfigsRef.current.length) {
        setSequenceComplete(true);
        setSessionMessage('Session complete.');
      } else {
        const nextConfig = frozenConfigsRef.current[nextRun.currentPosition];
        if (nextRun.status !== 'running' || !nextConfig) {
          throw new Error('The next sequence condition is unavailable.');
        }
        await activateCondition(runtime.scope, nextConfig, runtime.runId, nextRun.currentPosition);
      }
    } catch (cause) {
      failSession(runtime, cause);
    }
  }, [setTimeLimitReached, stopSessionActivity, ownsRuntime, activateCondition, failSession]);

  useEffect(() => {
    handleTimeLimitEndRef.current = () => { void finishSession('time'); };
  }, [finishSession]);


  // ---- Resume from pause ----
  const resumeSession = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ownsRuntime(runtime) || !isPausedRef.current || runtime.ending || runtime.failed) return;

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
    if (timeLimitRemainingMsRef.current !== null) {
      scheduleTimeLimit(timeLimitRemainingMsRef.current, runtime);
    }
    timeLimitRemainingMsRef.current = null;

    const latest = useSessionStore.getState();
    void logSessionEvent(runtime, {
      event: 'resume',
      value: {
        moneyCounter: latest.moneyCounter,
        totalClicks: latest.totalClicks,
      },
    });
  }, [ownsRuntime, scheduleTimeLimit, logSessionEvent]);

  // Timers always invoke the latest resume handler.
  const resumeSessionRef = useRef(resumeSession);
  useEffect(() => { resumeSessionRef.current = resumeSession; }, [resumeSession]);

  // ---- Enter pause ----
  const pauseSession = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ownsRuntime(runtime) || runtime.ending || runtime.failed || isPausedRef.current || !config || config.sessionId !== runtime.sessionId) return;

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
    void logSessionEvent(runtime, {
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
        if (ownsRuntime(runtime) && !runtime.ending && !runtime.failed) resumeSessionRef.current();
      }, durationSec * 1000);
      pauseCountdownRef.current = setInterval(() => {
        if (ownsRuntime(runtime) && !runtime.ending && !runtime.failed) {
          setPauseRemainingSec(prev => (prev !== null ? Math.max(0, prev - 1) : null));
        }
      }, 1000);
    } else {
      setPauseRemainingSec(null);
    }
  }, [config, ownsRuntime, logSessionEvent]);

  // Latest pauseSession callback (so handleInputActivation can call it without re-binding).
  const pauseSessionRef = useRef(pauseSession);
  useEffect(() => { pauseSessionRef.current = pauseSession; }, [pauseSession]);

  useEffect(() => {
    const scope: SessionScope = { routeKey, cancelled: false };
    if (!routeSessionId && !runId) {
      navigate('/');
      return;
    }
    const retireScope = () => {
      if (scope.cancelled) return;
      scope.cancelled = true;
      const runtime = runtimeRef.current;
      if (runtime?.scope !== scope) return;
      if (useSessionStore.getState().config?.sessionId === runtime.sessionId) endSession();
      runtimeRef.current = null;
      clearSessionTimers();
      audioRef.current?.pause();
      if (runtime.runId) {
        void api.interruptSequenceRun(runtime.runId, { keepalive: true }).catch(cause => {
          console.error('Abandoned sequence run could not be marked interrupted.', cause);
        });
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      retireScope();
      // A restored document must recheck persisted lifecycle state, never revive its old runtime.
      window.location.reload();
    };
    if (runId) {
      window.addEventListener('pagehide', retireScope);
      window.addEventListener('pageshow', handlePageShow);
    }
    setLoading(true);
    setError(null);
    setSessionMessage('');
    setSequenceComplete(false);
    setSequenceBalance(0);
    frozenConfigsRef.current = [];
    void (async () => {
      try {
        if (runId) {
          let run: SequenceRun = await api.getSequenceRun(runId);
          if (scope.cancelled || routeKeyRef.current !== scope.routeKey) return;
          if (run.status === 'running' && (run.currentPosition > 0 ||
            run.entries.some(entry => entry.startedAt !== null || entry.endedAt !== null))) {
            try {
              run = await api.interruptSequenceRun(runId);
            } catch (cause) {
              const detail = cause instanceof Error ? cause.message : 'Request failed';
              throw new Error(`This sequence run cannot be resumed. Run could not be marked interrupted. ${detail} A researcher must start a new run to continue.`);
            }
            if (scope.cancelled || routeKeyRef.current !== scope.routeKey) return;
            if (run.status === 'running') {
              throw new Error('This sequence run cannot be resumed. Run could not be marked interrupted. A researcher must start a new run to continue.');
            }
          }
          const frozenConfigs = run.entries.map(entry =>
            normalizeSessionConfig(entry.config, entry.sessionId, entry.configId));
          frozenConfigsRef.current = frozenConfigs;
          setSequenceBalance(run.sequenceBalance);
          if (run.status === 'completed') {
            const lastConfig = frozenConfigs[frozenConfigs.length - 1];
            if (!lastConfig) throw new Error('Sequence configuration not found.');
            setConfig(lastConfig);
            setSequenceComplete(true);
            setSessionMessage('Session complete.');
            setLoading(false);
            return;
          }
          if (run.status !== 'running') {
            throw new Error('This sequence run is interrupted. A researcher must start a new run to continue.');
          }
          const entry = run.entries[run.currentPosition];
          if (!entry) throw new Error('Sequence configuration not found.');
          await activateCondition(scope, frozenConfigs[run.currentPosition], runId, run.currentPosition);
        } else {
          const sessionData = await api.getSessionData(routeSessionId!);
          if (scope.cancelled || routeKeyRef.current !== scope.routeKey) return;
          if (sessionData.sequenceRunId) {
            throw new Error('This session belongs to a sequence run. Use the sequence runner to participate.');
          }
          const raw = sessionData.sessionConfig;
          await activateCondition(scope, normalizeSessionConfig(raw, routeSessionId!, raw.configId ?? ''));
        }
      } catch (cause) {
        if (scope.cancelled || routeKeyRef.current !== scope.routeKey) return;
        setError(cause instanceof Error ? cause.message : 'Failed to load session');
        setLoading(false);
      }
    })();
    return () => {
      window.removeEventListener('pagehide', retireScope);
      window.removeEventListener('pageshow', handlePageShow);
      retireScope();
    };
  }, [routeSessionId, runId, routeKey, navigate, activateCondition, endSession, clearSessionTimers, setConfig]);

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
    const runtime = runtimeRef.current;
    if (!config || !runtime || !ownsRuntime(runtime) || config.sessionId !== runtime.sessionId) return;
    if (isPausedRef.current || runtime.ending || runtime.failed || !useSessionStore.getState().sessionActive) return;

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
    lastActivatedTimerRef.current = setTimeout(() => {
      if (ownsRuntime(runtime) && !runtime.ending && !runtime.failed) setLastActivatedInput(null);
    }, 200);

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
    void logSessionEvent(runtime, {
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
  }, [config, ownsRuntime, logSessionEvent, finishSession,
    incrementClick, incrementInterval, getRewardTarget, resetInterval, deliverReward, bankReward, consumePendingReward]);

  // Physical inputs for the external input hook
  const physicalInputs = useMemo(() => config?.inputs.filter(i => i.type !== 'screen') ?? [], [config]);

  useExternalInput({
    inputs: physicalInputs,
    onInput: handleInputActivation,
    enabled: !isPaused && sessionActive && !runtimeRef.current?.ending && !runtimeRef.current?.failed,
    tracking: !error && !sequenceComplete && (Boolean(runId) || !runtimeRef.current?.ending),
    boundaryKey: runId ? sessionId : undefined,
  });

  // ---- Manual-resume listener while paused ----
  useEffect(() => {
    if (!isPaused) return;
    if (!config || (config.pauseResumeMode ?? 'auto') !== 'manual') return;
    const runtime = runtimeRef.current;
    if (!runtime || !ownsRuntime(runtime) || config.sessionId !== runtime.sessionId) return;

    const binding = config.pauseResumeBinding ?? { type: 'any' as const };

    // Guard against double-fire
    let fired = false;
    const resumeOnce = () => {
      if (fired || !ownsRuntime(runtime) || runtime.ending || runtime.failed) return;
      fired = true;
      resumeSession();
    };

    // Keyboard listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (runId && e.repeat) return;
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
  }, [isPaused, config, resumeSession, runId, ownsRuntime]);

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
        <p role="alert" className="text-destructive">{error || 'Session not found'}</p>
        <Button variant="link" onClick={() => navigate('/')}>Return to Home</Button>
      </div>
    );
  }

  const isDisabled = sequenceComplete || isPaused || !sessionActive || runtimeRef.current?.ending || runtimeRef.current?.failed;
  const screenInputs = config.inputs.filter(i => i.type === 'screen' && i.shape !== 'none');
  const showMoney = config.showMoneyToParticipant !== false;

  // Manual-resume overlay text
  const resumeBinding = config.pauseResumeBinding ?? { type: 'any' as const };
  const resumeBindingLabel =
    resumeBinding.type === 'any'
      ? 'any key or button'
      : resumeBinding.inputLabel ?? 'the assigned input';

  return (
    <div role="group" aria-label="Participant apparatus" className="flex flex-col items-center justify-center min-h-[70vh] space-y-20 relative">
      {/* Money Display (hidden when configured for participant) */}
      {showMoney && (
        <div className="text-center">
          <output aria-label="Balance" aria-live="off" className="block text-7xl font-bold text-primary animate-in">
            {runId
              ? formatMoney(sequenceComplete ? sequenceBalance : sequenceBalance + moneyCounter - config.startingMoney)
              : `${formatMoney(moneyCounter)} / ${formatMoney(config.moneyLimit)}`}
          </output>
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
              'disabled:hover:scale-100',
              !runId && 'disabled:opacity-50 disabled:cursor-not-allowed',
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
        <div className={runId ? 'text-muted-foreground' : 'bg-accent/20 border border-accent text-accent-foreground px-6 py-3 rounded-lg animate-in'}>
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
