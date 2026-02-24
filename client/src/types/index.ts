// Re-export from server types (keep types in sync)
export type ButtonShape = 'none' | 'rectangle' | 'square' | 'circle';
export type ButtonPosition = 'left' | 'middle' | 'right';
export type SessionLengthType = 'seconds' | 'points';
export type ExternalInputType = 'keyboard' | 'gamepad_button' | 'gamepad_axis';
export type InputType = 'screen' | 'keyboard' | 'gamepad_button' | 'gamepad_axis';

export interface ButtonConfig {
  shape: ButtonShape;
  color: string;
}

export interface ExternalInputConfig {
  id: string;
  name: string;
  inputType: ExternalInputType;
  inputCode: string;
  inputLabel: string;
  isActive: boolean;
  moneyAwarded: number;
  awardInterval: number;
  playAwardSound: boolean;
}

// Unified input configuration (new model)
export interface InputConfig {
  id: string;
  name: string;
  type: InputType;
  // Screen-only
  shape?: ButtonShape;
  color?: string;
  // Physical-only
  inputCode?: string;
  inputLabel?: string;
  // Reward settings (per-input)
  isRewarded: boolean;
  moneyAwarded: number;    // cents
  awardInterval: number;   // activations per reward
  playAwardSound: boolean;
}

// New base configuration with unified input model
export interface BaseConfig {
  timeLimit: number;
  moneyLimit: number;           // cents
  startingMoney: number;        // cents
  continueAfterMoneyLimit: boolean;
  inputs: InputConfig[];
}

// Legacy base config (for backward compatibility with old stored data)
export interface LegacyBaseConfig {
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
  externalInputs?: ExternalInputConfig[];
}

// Stored configuration with metadata
export interface Configuration {
  configId: string;
  name: string;
  config: string; // JSON string of BaseConfig (or LegacyBaseConfig)
  createdAt: string;
  isArchived?: number; // 0 or 1
  sessionCount?: number;
}

export interface SessionConfig {
  sessionId: string;
  configId: string;
  timeLimit: number;
  moneyLimit: number;
  startingMoney: number;
  continueAfterMoneyLimit: boolean;
  inputs: InputConfig[];
}

// Raw config as stored in DB — could be old or new format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawStoredConfig = Record<string, any>;

// Extended config type for viewing sessions (includes legacy field names)
export interface SessionConfigExtended extends Partial<SessionConfig> {
  // Legacy fields that may appear in old stored data
  buttonActive?: ButtonPosition | null;
  moneyAwarded?: number;
  awardInterval?: number;
  playAwardSound?: boolean;
  leftButton?: ButtonConfig;
  middleButton?: ButtonConfig;
  rightButton?: ButtonConfig;
  externalInputs?: ExternalInputConfig[];
  sessionLimit?: number | string;
  pointsLimit?: number;
  endAtLimit?: boolean;
  leftButtonShape?: string;
  leftButtonColor?: string;
  middleButtonShape?: string;
  middleButtonColor?: string;
  rightButtonShape?: string;
  rightButtonColor?: string;
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
