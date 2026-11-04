import { z } from 'zod';

// Button configuration schemas
export const ButtonShapeSchema = z.enum(['none', 'rectangle', 'square', 'circle']);
export const ButtonPositionSchema = z.enum(['left', 'middle', 'right']);
export const ExternalInputTypeSchema = z.enum(['keyboard', 'gamepad_button', 'gamepad_axis']);
export const InputTypeSchema = z.enum(['screen', 'keyboard', 'gamepad_button', 'gamepad_axis']);
export const RewardScheduleSchema = z.enum(['fixed', 'variable', 'custom']);

export const ButtonConfigSchema = z.object({
  shape: ButtonShapeSchema,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

// Legacy external input schema (old format)
export const ExternalInputConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  inputType: ExternalInputTypeSchema,
  inputCode: z.string(),
  inputLabel: z.string(),
  isActive: z.boolean(),
  moneyAwarded: z.number().int().nonnegative(),
  awardInterval: z.number().int().positive(),
  rewardSchedule: RewardScheduleSchema.optional(),
  rewardIntervals: z.array(z.number().int().positive()).optional(),
  playAwardSound: z.boolean(),
});

// Unified input config schema (new format)
export const InputConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: InputTypeSchema,
  // Screen-only
  shape: ButtonShapeSchema.optional(),
  color: z.string().optional(),
  // Physical-only
  inputCode: z.string().optional(),
  inputLabel: z.string().optional(),
  // Physical-only: whether to show a visual indicator on screen when activated
  showHighlight: z.boolean().optional(),
  // Reward settings
  isRewarded: z.boolean(),
  moneyAwarded: z.number().int().nonnegative(),
  awardInterval: z.number().int().positive(),
  rewardSchedule: RewardScheduleSchema.optional(),
  rewardIntervals: z.array(z.number().int().positive()).optional(),
  playAwardSound: z.boolean(),
});

// Pause/resume configuration
export const PauseTriggerSchema = z.enum(['any', 'rewarded']);
export const PauseResumeModeSchema = z.enum(['auto', 'manual']);
export const PauseResumeBindingTypeSchema = z.enum(['any', 'keyboard', 'gamepad_button', 'gamepad_axis']);

export const PauseResumeBindingSchema = z.object({
  type: PauseResumeBindingTypeSchema,
  inputCode: z.string().optional(),
  inputLabel: z.string().optional(),
});

// New session config schema (unified input model)
export const SessionConfigSchema = z.object({
  timeLimit: z.number().int().positive(),
  moneyLimit: z.number().int().nonnegative(),
  startingMoney: z.number().int().nonnegative(),
  continueAfterMoneyLimit: z.boolean(),
  inputs: z.array(InputConfigSchema),
  // New optional participant/pause options
  showMoneyToParticipant: z.boolean().optional(),
  pauseEnabled: z.boolean().optional(),
  pauseTrigger: PauseTriggerSchema.optional(),
  pauseAfterResponses: z.number().int().positive().optional(),
  pauseDurationSeconds: z.number().int().positive().optional(),
  pauseResumeMode: PauseResumeModeSchema.optional(),
  pauseResumeBinding: PauseResumeBindingSchema.optional(),
  // Changeover delay (session-wide)
  changeoverDelayEnabled: z.boolean().optional(),
  changeoverDelayMs: z.number().int().positive().optional(),
});

// Legacy session config schema (old format — still accepted on read)
export const LegacySessionConfigSchema = z.object({
  timeLimit: z.number().int().positive(),
  moneyAwarded: z.number().int().nonnegative(),
  moneyLimit: z.number().int().nonnegative(),
  startingMoney: z.number().int().nonnegative(),
  awardInterval: z.number().int().positive(),
  rewardSchedule: RewardScheduleSchema.optional(),
  rewardIntervals: z.array(z.number().int().positive()).optional(),
  playAwardSound: z.boolean(),
  continueAfterMoneyLimit: z.boolean(),
  buttonActive: ButtonPositionSchema.nullable(),
  leftButton: ButtonConfigSchema,
  middleButton: ButtonConfigSchema,
  rightButton: ButtonConfigSchema,
  externalInputs: z.array(ExternalInputConfigSchema).optional(),
});

export const IdentifierSchema = z.string().min(1).max(100).refine(value => value.trim().length > 0);
export const StoredConfigSchema = z.union([
  SessionConfigSchema,
  LegacySessionConfigSchema.merge(SessionConfigSchema.omit({ inputs: true })),
]);
export const StartSequenceRunSchema = z.object({
  participantId: IdentifierSchema,
});

export type SequenceRunStatus = 'running' | 'completed' | 'interrupted';
export type SequenceSessionStatus = 'planned' | 'active' | 'completed' | 'interrupted';
export type StoredConfig = z.infer<typeof StoredConfigSchema>;

export interface SequenceRunEntry {
  position: number;
  sessionId: string;
  configId: string;
  configName: string;
  config: StoredConfig;
  startedAt: string | null;
  endedAt: string | null;
}

export interface SequenceRun {
  runId: string;
  sequenceId: string;
  sequenceName: string;
  participantId: string;
  status: SequenceRunStatus;
  currentPosition: number;
  sequenceBalance: number;
  createdAt: string;
  endedAt: string | null;
  entries: SequenceRunEntry[];
}

export const SessionSequenceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  configIds: z.array(z.string().min(1).max(100)).min(1),
});

type SessionSequenceInput = z.infer<typeof SessionSequenceInputSchema>;

export interface SessionSequence extends SessionSequenceInput {
  sequenceId: string;
  createdAt: string;
}

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
    clicks: z.record(z.number().int().nonnegative()),
    totalClicks: z.number().int().nonnegative(),
    pendingRewards: z.record(z.number().int().nonnegative()),
  }),
});

// TypeScript types derived from schemas
export type ButtonShape = z.infer<typeof ButtonShapeSchema>;
export type ButtonPosition = z.infer<typeof ButtonPositionSchema>;
export type ExternalInputType = z.infer<typeof ExternalInputTypeSchema>;
export type InputType = z.infer<typeof InputTypeSchema>;
export type RewardSchedule = z.infer<typeof RewardScheduleSchema>;
export type ButtonConfig = z.infer<typeof ButtonConfigSchema>;
export type ExternalInputConfig = z.infer<typeof ExternalInputConfigSchema>;
export type InputConfig = z.infer<typeof InputConfigSchema>;
export type PauseTrigger = z.infer<typeof PauseTriggerSchema>;
export type PauseResumeMode = z.infer<typeof PauseResumeModeSchema>;
export type PauseResumeBindingType = z.infer<typeof PauseResumeBindingTypeSchema>;
export type PauseResumeBinding = z.infer<typeof PauseResumeBindingSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type LegacySessionConfig = z.infer<typeof LegacySessionConfigSchema>;
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
export interface PauseResumeEventRow {
  event: 'pause' | 'resume';
  timestamp: string;
}

export interface SessionDataResponse {
  sessionConfig: StoredConfig;
  startEvent: SessionStartEvent | null;
  endEvent: SessionEndEvent | null;
  allClicks: ClickEvent[];
  pauseEvents: PauseResumeEventRow[];
  sequenceRunId?: string;
  sequencePosition?: number;
  sequenceStatus?: SequenceSessionStatus;
}

export interface SessionListResponse {
  sessionId: string;
  participantId: string;
  configId: string;
  configName: string;
  startedAt: string | null;
  endedAt: string | null;
  sequenceRunId?: string;
  sequencePosition?: number;
  sequenceStatus?: SequenceSessionStatus;
  totalClicks: number;
  duration: number | null;
  finalMoney: number | null;
}

export interface SequenceSessionMetadata {
  sequenceRunId: string | null;
  sequencePosition: number | null;
  sequenceStatus: SequenceSessionStatus | null;
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
