import { Router } from 'express';
import { z } from 'zod';
import { runInTransaction, statements } from '../db/index.js';
import { readSequenceRun } from '../db/sequenceRuns.js';
import { IdentifierSchema } from '../types/index.js';
import { emit } from '../live/sessionEmitter.js';

const router = Router();
const InterruptRunSchema = z.object({}).strict();

router.param('runId', (_req, res, next, value: string) => {
  if (!IdentifierSchema.safeParse(value).success) {
    res.status(400).json({ error: 'Invalid sequence run ID' });
    return;
  }
  next();
});

router.get('/', (_req, res) => {
  try {
    res.json(statements.getAllSequenceRuns.all());
  } catch (error) {
    console.error('Error fetching sequence runs:', error);
    res.status(500).json({ error: 'Failed to fetch sequence runs' });
  }
});

router.get('/:runId', (req, res) => {
  try {
    const run = readSequenceRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'Sequence run not found' });
      return;
    }
    res.json(run);
  } catch (error) {
    console.error('Error fetching sequence run:', error);
    res.status(500).json({ error: 'Failed to fetch sequence run' });
  }
});

router.post('/:runId/interrupt', (req, res) => {
  try {
    if (!InterruptRunSchema.safeParse(req.body ?? {}).success) {
      res.status(400).json({ error: 'Invalid interruption request' });
      return;
    }

    const saved = runInTransaction(() => {
      const timestamp = new Date().toISOString();
      const { changes } = statements.interruptSequenceRun.run(timestamp, req.params.runId);
      const run = readSequenceRun(req.params.runId);
      if (changes > 0 && !run) throw new Error('Interrupted sequence run could not be read');
      return { run, interruptedAt: changes > 0 ? timestamp : undefined };
    });
    const { run } = saved;
    if (!run) {
      res.status(404).json({ error: 'Sequence run not found' });
      return;
    }
    if (saved.interruptedAt) {
      for (const entry of run.entries) {
        if (entry.startedAt === null || entry.endedAt !== null) continue;
        emit(entry.sessionId, {
          type: 'interrupted',
          sessionId: entry.sessionId,
          timestamp: saved.interruptedAt,
          data: { sequenceRunId: run.runId, sequencePosition: entry.position, sequenceStatus: 'interrupted' },
        });
      }
    }
    res.json(run);
  } catch (error) {
    console.error('Error interrupting sequence run:', error);
    res.status(500).json({ error: 'Failed to interrupt sequence run' });
  }
});

export default router;
