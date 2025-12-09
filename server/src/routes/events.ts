import { Router } from 'express';
import { statements } from '../db/index.js';
import { z } from 'zod';

const router = Router();

// Log event schema
const LogEventSchema = z.object({
  sessionId: z.string(),
  event: z.enum(['start', 'end', 'click']),
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

    // Verify session exists
    const session = statements.getSession.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    statements.insertEvent.run(
      sessionId,
      event,
      JSON.stringify(value),
      timestamp
    );

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
