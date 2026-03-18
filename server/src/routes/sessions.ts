import { Router } from 'express';
import { statements } from '../db/index.js';
import { subscribe } from '../live/sessionEmitter.js';
import { z } from 'zod';

interface SessionRow {
  sessionId: string;
  participantId: string;
  configId: string;
  configName: string;
  config: string;
  startedAt: string;
  endedAt: string | null;
}

interface EventRow {
  id: number;
  sessionId: string;
  event: string;
  value: string;
  timestamp: string;
}

// Helper to normalize click event data from old/new formats
function normalizeClickValue(value: Record<string, unknown>) {
  // Old format: { clicks: { total, left, middle, right }, buttonClicked, pointsCounter, ... }
  // New format: { clicks: { total, left, middle, right }, buttonClicked, moneyCounter, awardedCents, ... }
  // External input format: also includes inputId, inputName, inputSource, externalInputClicks
  
  const clicks = (value.clicks as Record<string, number>) || value;
  const moneyCounter = (value.moneyCounter ?? value.pointsCounter ?? 0) as number;
  const moneyLimitReached = (value.moneyLimitReached ?? value.limitReached ?? false) as boolean;
  const timeLimitReached = (value.timeLimitReached ?? false) as boolean;
  
  // New-format sessions log by inputId (not buttonClicked) and store totalClicks at top level
  const isNewFormat = value.inputId !== undefined;

  const result: Record<string, unknown> = {
    buttonClicked: (value.buttonClicked ?? value.inputId ?? 'unknown') as string,
    clickInfo: {
      total: (isNewFormat ? (value.totalClicks ?? 0) : (clicks.total ?? 0)) as number,
      left: (clicks.left ?? 0) as number,
      middle: (clicks.middle ?? 0) as number,
      right: (clicks.right ?? 0) as number,
      awardedCents: (value.awardedCents ?? value.awardedPoints ?? 0) as number,
    },
    sessionInfo: {
      moneyCounter,
      moneyLimitReached,
      timeLimitReached,
    },
  };

  // Pass through external input fields if present
  if (value.inputId) result.inputId = value.inputId;
  if (value.inputName) result.inputName = value.inputName;
  if (value.inputSource) result.inputSource = value.inputSource;
  if (value.externalInputClicks) result.externalInputClicks = value.externalInputClicks;

  return result;
}

// Helper to normalize end event data
function normalizeEndValue(value: Record<string, unknown>) {
  const clicks = (value.clicks as Record<string, number>) || value;
  return {
    finalMoney: (value.moneyCounter ?? value.pointsEarnedFinal ?? value.pointsCounter ?? 0) as number,
    totalClicks: (clicks.total ?? 0) as number,
  };
}

const router = Router();

const StartSessionSchema = z.object({
  participantId: z.string().min(1).max(100),
  configId: z.string(),
});

// Get all sessions
router.get('/', (_req, res) => {
  try {
    const sessions = statements.getAllSessions.all();
    
    const sessionsWithStats = (sessions as SessionRow[]).map((session) => {
      const clickCount = statements.getEventCount.get(session.sessionId, 'click') as { count: number };
      const endEvent = statements.getSessionEventByType.get(session.sessionId, 'end') as EventRow | undefined;
      
      let finalMoney = null;
      let duration = null;

      if (endEvent) {
        const endData = normalizeEndValue(JSON.parse(endEvent.value));
        finalMoney = endData.finalMoney;
        
        const startEvent = statements.getSessionEventByType.get(session.sessionId, 'start') as EventRow | undefined;
        if (startEvent && session.endedAt) {
          const startTime = new Date(startEvent.timestamp).getTime();
          const endTime = new Date(endEvent.timestamp).getTime();
          duration = Math.round((endTime - startTime) / 1000);
        }
      }

      return {
        sessionId: session.sessionId,
        participantId: session.participantId,
        configId: session.configId,
        configName: session.configName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        totalClicks: clickCount.count,
        duration,
        finalMoney,
      };
    });

    res.json(sessionsWithStats);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get session data (config + events)
router.get('/:sessionId/data', (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log('Looking up session:', sessionId);
    
    const session = statements.getSession.get(sessionId) as SessionRow | undefined;
    console.log('Session found:', session);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const sessionConfig = JSON.parse(session.config);
    const startEventRow = statements.getSessionEventByType.get(sessionId, 'start') as EventRow | undefined;
    const endEventRow = statements.getSessionEventByType.get(sessionId, 'end') as EventRow | undefined;
    const clickRows = statements.getClickEvents.all(sessionId) as EventRow[];

    const startEvent = startEventRow ? {
      sessionId,
      timestamp: startEventRow.timestamp,
      value: JSON.parse(startEventRow.value),
    } : null;

    const endEvent = endEventRow ? {
      sessionId,
      timestamp: endEventRow.timestamp,
      value: JSON.parse(endEventRow.value),
    } : null;

    const allClicks = clickRows.map((row) => {
      const value = JSON.parse(row.value);
      const normalized = normalizeClickValue(value);
      return {
        sessionId,
        timestamp: row.timestamp,
        ...normalized,
      };
    });

    const response = {
      sessionConfig,
      startEvent,
      endEvent,
      allClicks,
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching session data:', error);
    res.status(500).json({ error: 'Failed to fetch session data' });
  }
});

// Start new session
router.post('/start', (req, res) => {
  try {
    const result = StartSessionSchema.safeParse(req.body);
    
    if (!result.success) {
      res.status(400).json({ 
        error: 'Invalid session data',
        details: result.error.flatten(),
      });
      return;
    }

    const { participantId, configId } = result.data;
    
    // Check if config exists
    const config = statements.getConfig.get(configId) as { config: string } | undefined;
    if (!config) {
      res.status(404).json({ error: 'Configuration not found' });
      return;
    }

    // Auto-generate sessionId: participantId-sequenceNumber
    const countResult = statements.getMaxSessionIdForParticipant.get(participantId) as { sessionCount: number };
    const sequenceNumber = countResult.sessionCount + 1;
    const sessionId = `${participantId}-${sequenceNumber}`;

    statements.insertSession.run(sessionId, participantId, configId);
    
    res.status(201).json({ 
      message: 'Session started successfully',
      sessionId,
      config: JSON.parse(config.config),
    });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// End session
router.post('/:sessionId/end', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = statements.getSession.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    statements.updateSessionEnd.run(new Date().toISOString(), sessionId);
    
    res.json({ message: 'Session ended successfully' });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// SSE live stream for a session
router.get('/:sessionId/stream', (req, res) => {
  const { sessionId } = req.params;

  const session = statements.getSession.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial snapshot: last known events
  const startRow = statements.getSessionEventByType.get(sessionId, 'start') as { value: string; timestamp: string } | undefined;
  const endRow = statements.getSessionEventByType.get(sessionId, 'end') as { value: string; timestamp: string } | undefined;
  const clickCount = (statements.getEventCount.get(sessionId, 'click') as { count: number }).count;

  send({
    type: 'connected',
    sessionId,
    snapshot: {
      hasStarted: !!startRow,
      hasEnded: !!endRow,
      clickCount,
      startData: startRow ? JSON.parse(startRow.value) : null,
      startTimestamp: startRow?.timestamp ?? null,
      endData: endRow ? JSON.parse(endRow.value) : null,
      endTimestamp: endRow?.timestamp ?? null,
    },
  });

  // Subscribe to live events
  const unsubscribe = subscribe(sessionId, (event) => {
    send({ type: event.type, sessionId: event.sessionId, timestamp: event.timestamp, data: event.data });
  });

  // Heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => {
    send({ type: 'heartbeat', timestamp: new Date().toISOString() });
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Get session notes
router.get('/:sessionId/notes', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = statements.getSession.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const row = statements.getSessionNotes.get(sessionId) as { sessionId: string; notes: string; updatedAt: string } | undefined;
    res.json({ sessionId, notes: row?.notes ?? '', updatedAt: row?.updatedAt ?? null });
  } catch (error) {
    console.error('Error fetching session notes:', error);
    res.status(500).json({ error: 'Failed to fetch session notes' });
  }
});

// Update session notes
router.put('/:sessionId/notes', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = statements.getSession.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const { notes } = req.body as { notes?: string };
    if (typeof notes !== 'string') {
      res.status(400).json({ error: 'notes must be a string' });
      return;
    }
    statements.upsertSessionNotes.run(sessionId, notes);
    res.json({ message: 'Notes saved', sessionId });
  } catch (error) {
    console.error('Error saving session notes:', error);
    res.status(500).json({ error: 'Failed to save session notes' });
  }
});

// Delete session
router.delete('/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = statements.getSession.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    statements.deleteSession.run(sessionId);
    
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
