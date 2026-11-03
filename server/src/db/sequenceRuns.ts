import { z } from 'zod';
import { statements } from './index.js';
import {
  SessionConfigSchema,
  StoredConfigSchema,
  type SequenceRun,
  type SequenceRunEntry,
  type SequenceRunStatus,
  type SequenceSessionMetadata,
  type StoredConfig,
} from '../types/index.js';

export const RewardCentsSchema = z.number().int().nonnegative().safe();

type RunRow = Omit<SequenceRun, 'entries'>;
type EntryRow = Omit<SequenceRunEntry, 'config'> & { config: string };

export interface SequenceRunMember {
  runId: string;
  position: number;
  startedAt: string | null;
  status: SequenceRunStatus;
  currentPosition: number;
  sequenceBalance: number;
}

export function parseStoredConfig(value: string): StoredConfig {
  const config: unknown = JSON.parse(value);
  const validated = StoredConfigSchema.parse(config);
  if (config && typeof config === 'object' && 'inputs' in config && Array.isArray(config.inputs)) {
    SessionConfigSchema.parse(config);
  }
  RewardCentsSchema.parse(validated.startingMoney);
  RewardCentsSchema.parse(validated.moneyLimit);
  if ('inputs' in validated) {
    for (const input of validated.inputs) RewardCentsSchema.parse(input.moneyAwarded);
  } else {
    RewardCentsSchema.parse(validated.moneyAwarded);
    for (const input of validated.externalInputs ?? []) RewardCentsSchema.parse(input.moneyAwarded);
  }
  // Validation must not strip stored fields or normalize the frozen configuration.
  return config as StoredConfig;
}

export function readSequenceRun(runId: string): SequenceRun | undefined {
  const run = statements.getSequenceRun.get(runId) as RunRow | undefined;
  if (!run) return undefined;

  const rows = statements.getSequenceRunEntries.all(runId) as EntryRow[];
  const entries = rows.map(entry => ({ ...entry, config: parseStoredConfig(entry.config) }));
  if (entries.length === 0) throw new Error(`Sequence run has no entries: ${runId}`);

  RewardCentsSchema.parse(run.sequenceBalance);
  return { ...run, entries };
}

export function sequenceWriteConflict(member: SequenceRunMember | undefined, event: string): string | null {
  if (!member) return null;
  if (member.status !== 'running') return 'Sequence run is not running';
  if (member.position !== member.currentPosition) return 'Session is not the current sequence entry';
  if (event === 'start') return member.startedAt === null ? null : 'Sequence session already started';
  return member.startedAt === null ? 'Sequence session has not started' : null;
}

export function sequenceMetadata(session: SequenceSessionMetadata): Partial<SequenceSessionMetadata> {
  return session.sequenceRunId === null ? {} : {
    sequenceRunId: session.sequenceRunId,
    sequencePosition: session.sequencePosition,
    sequenceStatus: session.sequenceStatus,
  };
}
