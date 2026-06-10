import { create } from 'zustand';
import type { InputConfig, SessionConfig } from '../types';
import { getGeneratedRewardSequenceLength, getNextRewardTarget } from '../lib/rewardSchedules';

function getRewardTargetForInput(input: Pick<InputConfig, 'awardInterval' | 'rewardSchedule' | 'rewardIntervals'>): number {
  return getNextRewardTarget(input).target;
}

interface SessionState {
  config: SessionConfig | null;
  moneyCounter: number; // in cents
  totalClicks: number;
  inputClickCounts: Record<string, number>;
  inputIntervalCounters: Record<string, number>;
  inputRewardTargets: Record<string, number>;
  inputRewardSequences: Record<string, number[]>;
  moneyLimitReached: boolean;
  timeLimitReached: boolean;
  sessionActive: boolean;
  
  // Actions
  setConfig: (config: SessionConfig) => void;
  incrementClick: (inputId: string) => void;
  incrementInterval: (inputId: string) => number;
  getRewardTarget: (inputId: string) => number;
  resetInterval: (inputId: string) => void;
  awardMoney: (cents: number) => void;
  setMoneyLimitReached: (reached: boolean) => void;
  setTimeLimitReached: (reached: boolean) => void;
  startSession: () => void;
  endSession: () => void;
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  config: null,
  moneyCounter: 0,
  totalClicks: 0,
  inputClickCounts: {},
  inputIntervalCounters: {},
  inputRewardTargets: {},
  inputRewardSequences: {},
  moneyLimitReached: false,
  timeLimitReached: false,
  sessionActive: false,

  setConfig: (config) => {
    const inputClickCounts: Record<string, number> = {};
    const inputIntervalCounters: Record<string, number> = {};
    const inputRewardTargets: Record<string, number> = {};
    const inputRewardSequences: Record<string, number[]> = {};
    const generatedSequenceLength = getGeneratedRewardSequenceLength(config.timeLimit);
    for (const input of config.inputs ?? []) {
      const rewardState = getNextRewardTarget(input, [], generatedSequenceLength);
      inputClickCounts[input.id] = 0;
      inputIntervalCounters[input.id] = 0;
      inputRewardTargets[input.id] = rewardState.target;
      inputRewardSequences[input.id] = rewardState.sequence;
    }
    // Reset all session-scoped flags, otherwise state from a previous session in
    // the same browser tab (e.g. moneyLimitReached) leaks into the new session and
    // short-circuits the reward branch.
    set({
      config,
      moneyCounter: config.startingMoney,
      totalClicks: 0,
      inputClickCounts,
      inputIntervalCounters,
      inputRewardTargets,
      inputRewardSequences,
      moneyLimitReached: false,
      timeLimitReached: false,
      sessionActive: false,
    });
  },

  incrementClick: (inputId) =>
    set((state) => ({
      totalClicks: state.totalClicks + 1,
      inputClickCounts: {
        ...state.inputClickCounts,
        [inputId]: (state.inputClickCounts[inputId] ?? 0) + 1,
      },
    })),

  incrementInterval: (inputId) => {
    const current = get().inputIntervalCounters[inputId] ?? 0;
    const next = current + 1;
    set((state) => ({
      inputIntervalCounters: {
        ...state.inputIntervalCounters,
        [inputId]: next,
      },
    }));
    return next;
  },
  getRewardTarget: (inputId) => {
    const state = get();
    const input = state.config?.inputs.find(i => i.id === inputId);
    return state.inputRewardTargets[inputId] ?? getRewardTargetForInput(input ?? { awardInterval: 1 });
  },

  resetInterval: (inputId) =>
    set((state) => {
      const generatedSequenceLength = getGeneratedRewardSequenceLength(state.config?.timeLimit);
      const rewardState = getNextRewardTarget(
        state.config?.inputs.find(i => i.id === inputId) ?? { awardInterval: 1 },
        state.inputRewardSequences[inputId],
        generatedSequenceLength,
      );
      return {
        inputIntervalCounters: {
          ...state.inputIntervalCounters,
          [inputId]: 0,
        },
        inputRewardTargets: {
          ...state.inputRewardTargets,
          [inputId]: rewardState.target,
        },
        inputRewardSequences: {
          ...state.inputRewardSequences,
          [inputId]: rewardState.sequence,
        },
      };
    }),

  awardMoney: (cents) =>
    set((state) => ({
      moneyCounter: state.moneyCounter + cents,
    })),

  setMoneyLimitReached: (reached) => 
    set({ moneyLimitReached: reached }),

  setTimeLimitReached: (reached) => 
    set({ timeLimitReached: reached }),

  startSession: () => 
    set({ sessionActive: true }),

  endSession: () => 
    set({ sessionActive: false }),

  resetSession: () =>
    set((state) => {
      const inputClickCounts: Record<string, number> = {};
      const inputIntervalCounters: Record<string, number> = {};
      const inputRewardTargets: Record<string, number> = {};
      const inputRewardSequences: Record<string, number[]> = {};
      const generatedSequenceLength = getGeneratedRewardSequenceLength(state.config?.timeLimit);
      for (const input of state.config?.inputs ?? []) {
        const rewardState = getNextRewardTarget(input, [], generatedSequenceLength);
        inputClickCounts[input.id] = 0;
        inputIntervalCounters[input.id] = 0;
        inputRewardTargets[input.id] = rewardState.target;
        inputRewardSequences[input.id] = rewardState.sequence;
      }
      return {
        moneyCounter: state.config?.startingMoney || 0,
        totalClicks: 0,
        inputClickCounts,
        inputIntervalCounters,
        inputRewardTargets,
        inputRewardSequences,
        moneyLimitReached: false,
        timeLimitReached: false,
        sessionActive: false,
      };
    }),
}));
