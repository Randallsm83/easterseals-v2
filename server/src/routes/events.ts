import { Router } from 'express';
import { runInTransaction, statements } from '../db/index.js';
import { RewardCentsSchema, sequenceWriteConflict, type SequenceRunMember } from '../db/sequenceRuns.js';
import { emit } from '../live/sessionEmitter.js';
import { z } from 'zod';

const router = Router();

// Log event schema
const LogEventSchema = z.object({
  sessionId: z.string(),
  event: z.enum(['start', 'click', 'pause', 'resume']),
  value: z.record(z.any()),
  timestamp: z.string().datetime().optional(),
});

// Log event
router.post('/', (req, res) => {
  try {
    const result = LogEventSchema.safeParse(req.body);
    
    if (!result.success) {
      res.status(400).json({ 
        error: 'Invalid event data',
        details: result.error.flatten(),
      });
      return;
    }

    const { sessionId, event, value } = result.data;
    const timestamp = result.data.timestamp || new Date().toISOString();

    const saved = runInTransaction(() => {
      const session = statements.getSession.get(sessionId) as { endedAt: string | null } | undefined;
      if (!session) return { status: 404, error: 'Session not found' } as const;
      if (session.endedAt !== null || statements.getSessionEventByType.get(sessionId, 'end')) {
        return { status: 409, error: 'Session already ended' } as const;
      }

      const member = statements.getSequenceRunMember.get(sessionId) as SequenceRunMember | undefined;
      const conflict = sequenceWriteConflict(member, event);
      if (conflict) return { status: 409, error: conflict } as const;
      let awardedCents = 0;
      if (member && event === 'click') {
        const reward = RewardCentsSchema.safeParse(value.awardedCents);
        if (!reward.success) return { status: 400, error: 'Invalid awardedCents for sequence response' } as const;
        const sequenceBalance = RewardCentsSchema.parse(member.sequenceBalance);
        if (!Number.isSafeInteger(sequenceBalance + reward.data)) {
          return { status: 400, error: 'Sequence balance exceeds safe integer cents' } as const;
        }
        awardedCents = reward.data;
      }

      statements.insertEvent.run(sessionId, event, JSON.stringify(value), timestamp);
      if (member && event === 'click') statements.addSequenceRunReward.run(awardedCents, member.runId);
      if (member && event === 'start') statements.updateSessionStart.run(timestamp, sessionId);
      return { status: 201 } as const;
    });

    if (saved.status !== 201) {
      res.status(saved.status).json({ error: saved.error });
      return;
    }

    // Broadcast to any live SSE listeners
    emit(sessionId, { type: event, sessionId, timestamp, data: value });

    res.status(201).json({ message: 'Event logged successfully' });
  } catch (error) {
    console.error('Error logging event:', error);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

// Get events for a session
router.get('/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { type } = req.query;

    let events;
    if (type) {
      events = statements.getSessionEventByType.all(sessionId, type);
    } else {
      events = statements.getSessionEvents.all(sessionId);
    }

    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export default router;
