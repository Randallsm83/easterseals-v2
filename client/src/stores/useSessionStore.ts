import { create } from 'zustand';
import type { SessionConfig } from '../types';

interface SessionState {
  config: SessionConfig | null;
  moneyCounter: number; // in cents
  clickCounts: {
    total: number;
    left: number;
    middle: number;
    right: number;
  };
  moneyLimitReached: boolean;
  timeLimitReached: boolean;
  sessionActive: boolean;
  
  // Actions
  setConfig: (config: SessionConfig) => void;
  incrementClick: (button: 'left' | 'middle' | 'right') => void;
  awardMoney: (cents: number) => void;
  setMoneyLimitReached: (reached: boolean) => void;
  setTimeLimitReached: (reached: boolean) => void;
  startSession: () => void;
  endSession: () => void;
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  config: null,
  moneyCounter: 0,
  clickCounts: {
    total: 0,
    left: 0,
    middle: 0,
    right: 0,
  },
  moneyLimitReached: false,
  timeLimitReached: false,
  sessionActive: false,

  setConfig: (config) => 
    set({ 
      config, 
      moneyCounter: config.startingMoney 
    }),

  incrementClick: (button) =>
    set((state) => ({
      clickCounts: {
        ...state.clickCounts,
        total: state.clickCounts.total + 1,
        [button]: state.clickCounts[button] + 1,
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
    set((state) => ({
      moneyCounter: state.config?.startingMoney || 0,
      clickCounts: {
        total: 0,
        left: 0,
        middle: 0,
        right: 0,
      },
      moneyLimitReached: false,
      timeLimitReached: false,
      sessionActive: false,
    })),
}));
