import { z } from 'zod';

// Button configuration schemas
export const ButtonShapeSchema = z.enum(['rectangle', 'square', 'circle']);
export const ButtonPositionSchema = z.enum(['left', 'middle', 'right']);
export const SessionLengthTypeSchema = z.enum(['seconds', 'points']);

export const ButtonConfigSchema = z.object({
  shape: ButtonShapeSchema,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

// Session configuration schema
export const SessionConfigSchema = z.object({
  sessionId: z.string().min(1).max(100),
  sessionLength: z.number().int().positive(),
  sessionLengthType: SessionLengthTypeSchema,
  continueAfterLimit: z.boolean(),
  buttonActive: ButtonPositionSchema,
  leftButton: ButtonConfigSchema,
  middleButton: ButtonConfigSchema,
  rightButton: ButtonConfigSchema,
  pointsAwarded: z.number().int().nonnegative(),
  clicksNeeded: z.number().int().positive(),
  startingPoints: z.number().int().nonnegative(),
});

// Click event schema
export const ClickEventSchema = z.object({
  sessionId: z.string(),
  timestamp: z.string().datetime(),
  buttonClicked: ButtonPositionSchema,
  clickInfo: z.object({
    total: z.number().int().nonnegative(),
    left: z.number().int().nonnegative(),
    middle: z.number().int().nonnegative(),
    right: z.number().int().nonnegative(),
    awardedPoints: z.number().int().nonnegative(),
  }),
  sessionInfo: z.object({
    pointsCounter: z.number().int().nonnegative(),
    limitReached: z.boolean(),
  }),
});

// Session event schemas
export const SessionStartEventSchema = z.object({
  sessionId: z.string(),
  timestamp: z.string().datetime(),
  value: z.object({
    pointsCounter: z.number().int().nonnegative(),
    limitReached: z.boolean(),
  }),
});

export const SessionEndEventSchema = z.object({
  sessionId: z.string(),
  timestamp: z.string().datetime(),
  value: z.object({
    pointsCounter: z.number().int().nonnegative(),
    pointsEarnedFinal: z.number().int().nonnegative(),
    limitReached: z.boolean(),
  }),
});

// TypeScript types derived from schemas
export type ButtonShape = z.infer<typeof ButtonShapeSchema>;
export type ButtonPosition = z.infer<typeof ButtonPositionSchema>;
export type SessionLengthType = z.infer<typeof SessionLengthTypeSchema>;
export type ButtonConfig = z.infer<typeof ButtonConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type ClickEvent = z.infer<typeof ClickEventSchema>;
export type SessionStartEvent = z.infer<typeof SessionStartEventSchema>;
export type SessionEndEvent = z.infer<typeof SessionEndEventSchema>;

// Database row types
export interface SessionConfigRow {
  sessionId: string;
  config: string;
  createdAt: string;
}

export interface EventLogRow {
  id: number;
  sessionId: string;
  event: string;
  value: string;
  timestamp: string;
}

// API response types
export interface SessionDataResponse {
  sessionConfig: SessionConfig;
  startEvent: SessionStartEvent | null;
  endEvent: SessionEndEvent | null;
  allClicks: ClickEvent[];
}

export interface SessionListResponse {
  sessionId: string;
  createdAt: string;
  totalClicks: number;
  duration: number | null;
  finalPoints: number | null;
}

// Analytics types
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
