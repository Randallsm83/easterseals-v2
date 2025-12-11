// Re-export from server types (keep types in sync)
export type ButtonShape = 'none' | 'rectangle' | 'square' | 'circle';
export type ButtonPosition = 'left' | 'middle' | 'right';
export type SessionLengthType = 'seconds' | 'points';

export interface ButtonConfig {
  shape: ButtonShape;
  color: string;
}

// Base configuration without sessionId (used for templates)
export interface BaseConfig {
  // Time limit in seconds
  timeLimit: number;
  // Money configuration (stored in cents)
  moneyAwarded: number;
  moneyLimit: number;
  startingMoney: number;
  awardInterval: number;
  playAwardSound: boolean;
  continueAfterMoneyLimit: boolean;
  // Button configuration
  buttonActive: ButtonPosition | null;
  leftButton: ButtonConfig;
  middleButton: ButtonConfig;
  rightButton: ButtonConfig;
}

// Stored configuration with metadata
export interface Configuration {
  configId: string;
  name: string;
  config: string; // JSON string of BaseConfig
  createdAt: string;
  isArchived?: number; // 0 or 1
}

export interface SessionConfig {
  sessionId: string;
  configId: string;
  timeLimit: number;
  moneyAwarded: number;
  moneyLimit: number;
  startingMoney: number;
  awardInterval: number;
  playAwardSound: boolean;
  continueAfterMoneyLimit: boolean;
  buttonActive: ButtonPosition | null;
  leftButton: ButtonConfig;
  middleButton: ButtonConfig;
  rightButton: ButtonConfig;
}

// Extended config type for viewing sessions (includes legacy field names)
export interface SessionConfigExtended extends Partial<SessionConfig> {
  buttonActive: ButtonPosition;
  // Legacy format fields (from old migrated data)
  sessionLimit?: number | string;
  pointsLimit?: number;
  endAtLimit?: boolean;
  leftButtonShape?: string;
  leftButtonColor?: string;
  middleButtonShape?: string;
  middleButtonColor?: string;
  rightButtonShape?: string;
  rightButtonColor?: string;
  // Points-based fields for backward compatibility
  pointsAwarded?: number;
  clicksNeeded?: number;
  startingPoints?: number;
}

export interface ClickInfo {
  total: number;
  left: number;
  middle: number;
  right: number;
  awardedCents: number;
}

export interface SessionInfo {
  moneyCounter: number;
  moneyLimitReached: boolean;
  timeLimitReached: boolean;
}

export interface ClickEvent {
  sessionId: string;
  timestamp: string;
  buttonClicked: ButtonPosition;
  clickInfo: ClickInfo;
  sessionInfo: SessionInfo;
}

export interface SessionStartEvent {
  sessionId: string;
  timestamp: string;
  value: {
    moneyCounter: number;
    moneyLimitReached: boolean;
    timeLimitReached: boolean;
  };
}

export interface SessionEndEvent {
  sessionId: string;
  timestamp: string;
  value: {
    moneyCounter: number;
    moneyLimitReached: boolean;
    timeLimitReached: boolean;
    clicks: {
      total: number;
      left: number;
      middle: number;
      right: number;
    };
  };
}

export interface SessionDataResponse {
  sessionConfig: SessionConfigExtended;
  startEvent: SessionStartEvent | null;
  endEvent: SessionEndEvent | null;
  allClicks: ClickEvent[];
}

export interface SessionListItem {
  sessionId: string;
  participantId: string;
  configId: string;
  configName: string;
  startedAt: string;
  endedAt: string | null;
  totalClicks: number;
  duration: number | null;
  finalMoney: number | null;
}

export interface SessionStats {
  sessionId: string;
  totalClicks: number;
  correctClicks: number;
  incorrectClicks: number;
  accuracy: number;
  clicksPerSecond: number;
  averageTimeBetweenClicks: number;
  moneyEarned: number;
  sessionDuration: number;
}

// Chart data types
export interface ChartDataPoint {
  timeElapsed: number;
  timestamp: string;
  left: number;
  middle: number;
  right: number;
  total: number;
  money: number;
  buttonClicked: ButtonPosition;
}

// Participant type for cascading dropdowns
export interface Participant {
  participantId: string;
  sessionCount: number;
  lastSessionDate: string | null;
  isArchived?: number; // 0 or 1
}
