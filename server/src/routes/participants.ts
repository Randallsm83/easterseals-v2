import { Router } from 'express';
import { statements } from '../db/index.js';

interface ParticipantRow {
  participantId: string;
  sessionCount: number;
  lastSessionDate: string | null;
  isArchived?: number;
}

interface SessionRow {
  sessionId: string;
  participantId: string;
  configId: string;
  configName: string;
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

const router = Router();

// Get all distinct participants with session counts
router.get('/', (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const archivedOnly = req.query.archivedOnly === 'true';
    
    let participants: ParticipantRow[];
    if (archivedOnly) {
      participants = statements.getArchivedParticipantsWithStats.all() as ParticipantRow[];
    } else if (includeArchived) {
      const active = statements.getParticipantsWithStats.all() as ParticipantRow[];
      const archived = statements.getArchivedParticipantsWithStats.all() as ParticipantRow[];
      participants = [...active, ...archived];
    } else {
      participants = statements.getParticipantsWithStats.all() as ParticipantRow[];
    }
    res.json(participants);
  } catch (error) {
    console.error('Error fetching participants:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// Get sessions for a participant
router.get('/:participantId/sessions', (req, res) => {
  try {
    const { participantId } = req.params;
    const sessions = statements.getSessionsByParticipant.all(participantId) as SessionRow[];
    
    const sessionsWithStats = sessions.map((session) => {
      const clickCount = statements.getEventCount.get(session.sessionId, 'click') as { count: number };
      const endEvent = statements.getSessionEventByType.get(session.sessionId, 'end') as EventRow | undefined;
      
      let finalMoney = null;
      let duration = null;

      if (endEvent) {
        const endData = JSON.parse(endEvent.value);
        finalMoney = endData.moneyCounter ?? endData.pointsCounter ?? 0;
        
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
    console.error('Error fetching participant sessions:', error);
    res.status(500).json({ error: 'Failed to fetch participant sessions' });
  }
});

// Get next session ID for a participant
router.get('/:participantId/next-session-id', (req, res) => {
  try {
    const { participantId } = req.params;
    const result = statements.getMaxSessionIdForParticipant.get(participantId) as { sessionCount: number };
    const nextSessionNumber = result.sessionCount + 1;
    res.json({ nextSessionId: nextSessionNumber.toString() });
  } catch (error) {
    console.error('Error getting next session ID:', error);
    res.status(500).json({ error: 'Failed to get next session ID' });
  }
});

// Archive a participant
router.post('/:participantId/archive', (req, res) => {
  try {
    const { participantId } = req.params;
    statements.archiveParticipant.run(participantId);
    res.json({ message: 'Participant archived successfully' });
  } catch (error) {
    console.error('Error archiving participant:', error);
    res.status(500).json({ error: 'Failed to archive participant' });
  }
});

// Unarchive a participant
router.post('/:participantId/unarchive', (req, res) => {
  try {
    const { participantId } = req.params;
    statements.unarchiveParticipant.run(participantId);
    res.json({ message: 'Participant unarchived successfully' });
  } catch (error) {
    console.error('Error unarchiving participant:', error);
    res.status(500).json({ error: 'Failed to unarchive participant' });
  }
});

export default router;
