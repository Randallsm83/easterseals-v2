import { create } from 'zustand';
import type { SessionConfig } from '../types';

interface SessionState {
  config: SessionConfig | null;
  pointsCounter: number;
  clickCounts: {
    total: number;
    left: number;
    middle: number;
    right: number;
  };
  limitReached: boolean;
  sessionActive: boolean;
  
  // Actions
  setConfig: (config: SessionConfig) => void;
  incrementClick: (button: 'left' | 'middle' | 'right') => void;
  awardPoints: (points: number) => void;
  setLimitReached: (reached: boolean) => void;
  startSession: () => void;
  endSession: () => void;
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  config: null,
  pointsCounter: 0,
  clickCounts: {
    total: 0,
    left: 0,
    middle: 0,
    right: 0,
  },
  limitReached: false,
  sessionActive: false,

  setConfig: (config) => 
    set({ 
      config, 
      pointsCounter: config.startingPoints 
    }),

  incrementClick: (button) =>
    set((state) => ({
      clickCounts: {
        ...state.clickCounts,
        total: state.clickCounts.total + 1,
        [button]: state.clickCounts[button] + 1,
      },
    })),

  awardPoints: (points) =>
    set((state) => ({
      pointsCounter: state.pointsCounter + points,
    })),

  setLimitReached: (reached) => 
    set({ limitReached: reached }),

  startSession: () => 
    set({ sessionActive: true }),

  endSession: () => 
    set({ sessionActive: false }),

  resetSession: () =>
    set((state) => ({
      pointsCounter: state.config?.startingPoints || 0,
      clickCounts: {
        total: 0,
        left: 0,
        middle: 0,
        right: 0,
      },
      limitReached: false,
      sessionActive: false,
    })),
}));
