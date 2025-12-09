import { Router } from 'express';
import { statements } from '../db/index.js';
import { z } from 'zod';

const router = Router();

const StartSessionSchema = z.object({
  sessionId: z.string().min(1).max(100),
  configId: z.string(),
});

// Get all sessions
router.get('/', (req, res) => {
  try {
    const sessions = statements.getAllSessions.all();
    
    const sessionsWithStats = sessions.map((session: any) => {
      const clickCount = statements.getEventCount.get(session.sessionId, 'click') as { count: number };
      const endEvent = statements.getSessionEventByType.get(session.sessionId, 'end') as any;
      
      let finalPoints = null;
      let duration = null;

      if (endEvent) {
        const endData = JSON.parse(endEvent.value);
        finalPoints = endData.pointsEarnedFinal || endData.pointsCounter;
        
        const startEvent = statements.getSessionEventByType.get(session.sessionId, 'start') as any;
        if (startEvent && session.endedAt) {
          const startTime = new Date(startEvent.timestamp).getTime();
          const endTime = new Date(endEvent.timestamp).getTime();
          duration = Math.round((endTime - startTime) / 1000);
        }
      }

      return {
        sessionId: session.sessionId,
        configId: session.configId,
        configName: session.configName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        totalClicks: clickCount.count,
        duration,
        finalPoints,
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
    
    const session = statements.getSession.get(sessionId) as any;
    console.log('Session found:', session);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const sessionConfig = JSON.parse(session.config);
    const startEventRow = statements.getSessionEventByType.get(sessionId, 'start') as any;
    const endEventRow = statements.getSessionEventByType.get(sessionId, 'end') as any;
    const clickRows = statements.getClickEvents.all(sessionId) as any[];

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

    const allClicks = clickRows.map((row: any) => {
      const value = JSON.parse(row.value);
      return {
        sessionId,
        timestamp: row.timestamp,
        buttonClicked: value.buttonClicked,
        clickInfo: {
          total: value.total,
          left: value.left,
          middle: value.middle,
          right: value.right,
          awardedPoints: value.awardedPoints || 0,
        },
        sessionInfo: {
          pointsCounter: value.pointsCounter,
          limitReached: value.limitReached || false,
        },
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
      return res.status(400).json({ 
        error: 'Invalid session data',
        details: result.error.flatten(),
      });
    }

    const { sessionId, configId } = result.data;
    
    // Check if session already exists
    const existing = statements.getSession.get(sessionId);
    if (existing) {
      return res.status(409).json({ error: 'Session ID already exists' });
    }

    // Check if config exists
    const config = statements.getConfig.get(configId);
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    statements.insertSession.run(sessionId, configId);
    
    res.status(201).json({ 
      message: 'Session started successfully',
      sessionId,
      config: JSON.parse(config.config as string),
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
      return res.status(404).json({ error: 'Session not found' });
    }

    statements.updateSessionEnd.run(new Date().toISOString(), sessionId);
    
    res.json({ message: 'Session ended successfully' });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// Delete session
router.delete('/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = statements.getSession.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    statements.deleteSession.run(sessionId);
    
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
