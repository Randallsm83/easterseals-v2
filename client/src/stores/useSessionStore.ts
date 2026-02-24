import { create } from 'zustand';
import type { SessionConfig } from '../types';

interface SessionState {
  config: SessionConfig | null;
  moneyCounter: number; // in cents
  totalClicks: number;
  inputClickCounts: Record<string, number>;
  inputIntervalCounters: Record<string, number>;
  moneyLimitReached: boolean;
  timeLimitReached: boolean;
  sessionActive: boolean;
  
  // Actions
  setConfig: (config: SessionConfig) => void;
  incrementClick: (inputId: string) => void;
  incrementInterval: (inputId: string) => number;
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
  moneyLimitReached: false,
  timeLimitReached: false,
  sessionActive: false,

  setConfig: (config) => {
    const inputClickCounts: Record<string, number> = {};
    const inputIntervalCounters: Record<string, number> = {};
    for (const input of config.inputs ?? []) {
      inputClickCounts[input.id] = 0;
      inputIntervalCounters[input.id] = 0;
    }
    set({
      config,
      moneyCounter: config.startingMoney,
      totalClicks: 0,
      inputClickCounts,
      inputIntervalCounters,
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

  resetInterval: (inputId) =>
    set((state) => ({
      inputIntervalCounters: {
        ...state.inputIntervalCounters,
        [inputId]: 0,
      },
    })),

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
      for (const input of state.config?.inputs ?? []) {
        inputClickCounts[input.id] = 0;
        inputIntervalCounters[input.id] = 0;
      }
      return {
        moneyCounter: state.config?.startingMoney || 0,
        totalClicks: 0,
        inputClickCounts,
        inputIntervalCounters,
        moneyLimitReached: false,
        timeLimitReached: false,
        sessionActive: false,
      };
    }),
}));
