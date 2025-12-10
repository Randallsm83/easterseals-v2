// Re-export from server types (keep types in sync)
export type ButtonShape = 'rectangle' | 'square' | 'circle';
export type ButtonPosition = 'left' | 'middle' | 'right';
export type SessionLengthType = 'seconds' | 'points';

export interface ButtonConfig {
  shape: ButtonShape;
  color: string;
}

// Base configuration without sessionId (used for templates)
export interface BaseConfig {
  sessionLength: number;
  sessionLengthType: SessionLengthType;
  continueAfterLimit: boolean;
  buttonActive: ButtonPosition;
  leftButton: ButtonConfig;
  middleButton: ButtonConfig;
  rightButton: ButtonConfig;
  pointsAwarded: number;
  clicksNeeded: number;
  startingPoints: number;
}

// Stored configuration with metadata
export interface Configuration {
  configId: string;
  name: string;
  config: string; // JSON string of BaseConfig
  createdAt: string;
}

export interface SessionConfig {
  sessionId: string;
  sessionLength: number;
  sessionLengthType: SessionLengthType;
  continueAfterLimit: boolean;
  buttonActive: ButtonPosition;
  leftButton: ButtonConfig;
  middleButton: ButtonConfig;
  rightButton: ButtonConfig;
  pointsAwarded: number;
  clicksNeeded: number;
  startingPoints: number;
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
}

export interface ClickInfo {
  total: number;
  left: number;
  middle: number;
  right: number;
  awardedPoints: number;
}

export interface SessionInfo {
  pointsCounter: number;
  limitReached: boolean;
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
    pointsCounter: number;
    limitReached: boolean;
  };
}

export interface SessionEndEvent {
  sessionId: string;
  timestamp: string;
  value: {
    pointsCounter: number;
    pointsEarnedFinal: number;
    limitReached: boolean;
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
  configId: string;
  configName: string;
  startedAt: string;
  endedAt: string | null;
  totalClicks: number;
  duration: number | null;
  finalPoints: number | null;
}

export interface SessionStats {
  sessionId: string;
  totalClicks: number;
  correctClicks: number;
  incorrectClicks: number;
  accuracy: number;
  clicksPerSecond: number;
  averageTimeBetweenClicks: number;
  pointsEarned: number;
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
  points: number;
  buttonClicked: ButtonPosition;
}
