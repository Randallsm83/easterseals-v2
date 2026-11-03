import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getNextSessionId, runInTransaction, statements } from '../db/index.js';
import { parseStoredConfig, readSequenceRun } from '../db/sequenceRuns.js';
import { IdentifierSchema, SessionSequenceInputSchema, StartSequenceRunSchema, type SessionSequence } from '../types/index.js';

const router = Router();
type SequenceRow = Omit<SessionSequence, 'configIds'>;

router.param('sequenceId', (_req, res, next, value: string) => {
  if (!IdentifierSchema.safeParse(value).success) {
    res.status(400).json({ error: 'Invalid session sequence ID' });
    return;
  }
  next();
});

function withEntries(sequence: SequenceRow): SessionSequence {
  const entries = statements.getSequenceEntries.all(sequence.sequenceId) as { configId: string }[];
  return { ...sequence, configIds: entries.map(entry => entry.configId) };
}

router.get('/', (_req, res) => {
  try {
    const sequences = statements.getAllSequences.all() as SequenceRow[];
    res.json(sequences.map(withEntries));
  } catch (error) {
    console.error('Error fetching session sequences:', error);
    res.status(500).json({ error: 'Failed to fetch session sequences' });
  }
});

router.get('/:sequenceId', (req, res) => {
  try {
    const sequence = statements.getSequence.get(req.params.sequenceId) as SequenceRow | undefined;
    if (!sequence) {
      res.status(404).json({ error: 'Session sequence not found' });
      return;
    }
    res.json(withEntries(sequence));
  } catch (error) {
    console.error('Error fetching session sequence:', error);
    res.status(500).json({ error: 'Failed to fetch session sequence' });
  }
});

router.post('/:sequenceId/runs', (req, res) => {
  try {
    const result = StartSequenceRunSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid sequence run', details: result.error.flatten() });
      return;
    }

    const { participantId } = result.data;
    const saved = runInTransaction(() => {
      const sequence = statements.getSequence.get(req.params.sequenceId) as SequenceRow | undefined;
      if (!sequence) return { status: 404, error: 'Session sequence not found' } as const;

      const entries = statements.getSequenceEntries.all(sequence.sequenceId) as { configId: string }[];
      if (entries.length === 0) return { status: 400, error: 'Session sequence has no configurations' } as const;

      const configs: { configId: string; name: string; config: string }[] = [];
      let startingBalance = 0;
      for (const entry of entries) {
        if (!IdentifierSchema.safeParse(entry.configId).success) {
          return { status: 400, error: 'Session sequence contains an invalid configuration ID' } as const;
        }
        const config = statements.getConfig.get(entry.configId) as { configId: string; name: string; config: string } | undefined;
        if (!config) return { status: 400, error: `Configuration not found: ${entry.configId}` } as const;
        try {
          const frozen = parseStoredConfig(config.config);
          if (configs.length === 0) startingBalance = frozen.startingMoney;
        } catch {
          return { status: 400, error: `Stored configuration is invalid: ${entry.configId}` } as const;
        }
        configs.push(config);
      }

      const runId = randomUUID();
      statements.insertSequenceRun.run(runId, sequence.sequenceId, sequence.name, participantId, startingBalance);
      configs.forEach((config, position) => {
        const sessionId = getNextSessionId(participantId);
        statements.insertPlannedSession.run(sessionId, participantId, config.configId);
        statements.insertSequenceRunEntry.run(runId, position, sessionId, config.configId, config.name, config.config);
      });
      const run = readSequenceRun(runId);
      if (!run) throw new Error('Created sequence run could not be read');
      return { status: 201, run } as const;
    });

    if (saved.status !== 201) {
      res.status(saved.status).json({ error: saved.error });
      return;
    }
    res.status(201).json(saved.run);
  } catch (error) {
    console.error('Error launching sequence run:', error);
    res.status(500).json({ error: 'Failed to launch sequence run' });
  }
});

router.post('/', (req, res) => {
  try {
    const result = SessionSequenceInputSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid session sequence', details: result.error.flatten() });
      return;
    }

    const { name, configIds } = result.data;
    const sequenceId = randomUUID();
    const saved = runInTransaction(() => {
      const missingConfigId = configIds.find(configId => !statements.getConfig.get(configId));
      if (missingConfigId) return { status: 400, missingConfigId } as const;

      statements.insertSequence.run(sequenceId, name);
      configIds.forEach((configId, position) => {
        statements.insertSequenceEntry.run(sequenceId, position, configId);
      });
      const sequence = statements.getSequence.get(sequenceId) as SequenceRow;
      return { status: 201, sequence: withEntries(sequence) } as const;
    });

    if (saved.status === 400) {
      res.status(400).json({ error: `Configuration not found: ${saved.missingConfigId}` });
      return;
    }
    res.status(201).json(saved.sequence);
  } catch (error) {
    console.error('Error creating session sequence:', error);
    res.status(500).json({ error: 'Failed to create session sequence' });
  }
});

router.put('/:sequenceId', (req, res) => {
  try {
    const result = SessionSequenceInputSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid session sequence', details: result.error.flatten() });
      return;
    }

    const { sequenceId } = req.params;
    const { name, configIds } = result.data;
    const saved = runInTransaction(() => {
      const sequence = statements.getSequence.get(sequenceId) as SequenceRow | undefined;
      if (!sequence) return { status: 404 } as const;

      const missingConfigId = configIds.find(configId => !statements.getConfig.get(configId));
      if (missingConfigId) return { status: 400, missingConfigId } as const;

      statements.updateSequence.run(name, sequenceId);
      statements.deleteSequenceEntries.run(sequenceId);
      configIds.forEach((configId, position) => {
        statements.insertSequenceEntry.run(sequenceId, position, configId);
      });
      return { status: 200, sequence: withEntries({ ...sequence, name }) } as const;
    });

    if (saved.status === 404) {
      res.status(404).json({ error: 'Session sequence not found' });
      return;
    }
    if (saved.status === 400) {
      res.status(400).json({ error: `Configuration not found: ${saved.missingConfigId}` });
      return;
    }
    res.json(saved.sequence);
  } catch (error) {
    console.error('Error updating session sequence:', error);
    res.status(500).json({ error: 'Failed to update session sequence' });
  }
});

router.delete('/:sequenceId', (req, res) => {
  try {
    const result = statements.deleteSequence.run(req.params.sequenceId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Session sequence not found' });
      return;
    }
    res.json({ message: 'Session sequence deleted successfully' });
  } catch (error) {
    console.error('Error deleting session sequence:', error);
    res.status(500).json({ error: 'Failed to delete session sequence' });
  }
});

export default router;
