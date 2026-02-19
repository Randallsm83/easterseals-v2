import { z } from 'zod';

// Button configuration schemas
export const ButtonShapeSchema = z.enum(['none', 'rectangle', 'square', 'circle']);
export const ButtonPositionSchema = z.enum(['left', 'middle', 'right']);

export const ButtonConfigSchema = z.object({
  shape: ButtonShapeSchema,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

// Session configuration schema (money-based reward system)
export const SessionConfigSchema = z.object({
  timeLimit: z.number().int().positive(),
  moneyAwarded: z.number().int().nonnegative(), // cents
  moneyLimit: z.number().int().nonnegative(), // cents
  startingMoney: z.number().int().nonnegative(), // cents
  awardInterval: z.number().int().positive(), // clicks needed
  playAwardSound: z.boolean(),
  continueAfterMoneyLimit: z.boolean(),
  buttonActive: ButtonPositionSchema.nullable(),
  leftButton: ButtonConfigSchema,
  middleButton: ButtonConfigSchema,
  rightButton: ButtonConfigSchema,
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
    awardedCents: z.number().int().nonnegative(),
  }),
  sessionInfo: z.object({
    moneyCounter: z.number().int().nonnegative(),
    moneyLimitReached: z.boolean(),
    timeLimitReached: z.boolean(),
  }),
});

// Session event schemas
export const SessionStartEventSchema = z.object({
  sessionId: z.string(),
  timestamp: z.string().datetime(),
  value: z.object({
    moneyCounter: z.number().int().nonnegative(),
    moneyLimitReached: z.boolean(),
    timeLimitReached: z.boolean(),
  }),
});

export const SessionEndEventSchema = z.object({
  sessionId: z.string(),
  timestamp: z.string().datetime(),
  value: z.object({
    moneyCounter: z.number().int().nonnegative(),
    moneyLimitReached: z.boolean(),
    timeLimitReached: z.boolean(),
    clicks: z.object({
      total: z.number().int().nonnegative(),
      left: z.number().int().nonnegative(),
      middle: z.number().int().nonnegative(),
      right: z.number().int().nonnegative(),
    }),
  }),
});

// TypeScript types derived from schemas
export type ButtonShape = z.infer<typeof ButtonShapeSchema>;
export type ButtonPosition = z.infer<typeof ButtonPositionSchema>;
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
  participantId: string;
  configId: string;
  configName: string;
  startedAt: string;
  endedAt: string | null;
  totalClicks: number;
  duration: number | null;
  finalMoney: number | null;
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
  moneyEarned: number;
  sessionDuration: number;
}
