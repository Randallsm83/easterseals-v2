import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '../../data/easterseals.db');

// Ensure the data directory exists before opening the database, since
// better-sqlite3 will not create parent directories on its own.
mkdirSync(dirname(DB_PATH), { recursive: true });

// Initialize database
export const db = new Database(DB_PATH);

// Enable foreign keys and WAL mode for better performance
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Prepared statements (initialized after database setup)
export let statements: ReturnType<typeof createStatements>;

// Create tables
export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS configurations (
      configId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      isArchived INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_sequences (
      sequenceId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_sequence_entries (
      sequenceId TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      configId TEXT NOT NULL,
      PRIMARY KEY (sequenceId, position),
      FOREIGN KEY (sequenceId) REFERENCES session_sequences(sequenceId) ON DELETE CASCADE,
      FOREIGN KEY (configId) REFERENCES configurations(configId) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_session_sequence_entries_configId
      ON session_sequence_entries(configId);

    CREATE TABLE IF NOT EXISTS sessions (
      sessionId TEXT PRIMARY KEY,
      participantId TEXT NOT NULL,
      configId TEXT NOT NULL,
      startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      endedAt DATETIME,
      FOREIGN KEY (configId) REFERENCES configurations(configId) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_participantId 
      ON sessions(participantId);

    CREATE TABLE IF NOT EXISTS session_event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      event TEXT NOT NULL,
      value TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(sessionId) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_event_log_sessionId 
      ON session_event_log(sessionId);
    
    CREATE INDEX IF NOT EXISTS idx_session_event_log_event 
      ON session_event_log(sessionId, event);
    
    CREATE INDEX IF NOT EXISTS idx_session_event_log_timestamp 
      ON session_event_log(timestamp);

    CREATE TABLE IF NOT EXISTS archived_participants (
      participantId TEXT PRIMARY KEY,
      archivedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_notes (
      sessionId TEXT PRIMARY KEY,
      notes TEXT NOT NULL DEFAULT '',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sessionId) REFERENCES sessions(sessionId) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sequence_runs (
      runId TEXT PRIMARY KEY,
      sequenceId TEXT NOT NULL,
      sequenceName TEXT NOT NULL,
      participantId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'interrupted')),
      currentPosition INTEGER NOT NULL DEFAULT 0 CHECK (currentPosition >= 0),
      sequenceBalance INTEGER NOT NULL CHECK (sequenceBalance >= 0 AND sequenceBalance <= 9007199254740991),
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      endedAt DATETIME,
      CHECK ((status = 'running' AND endedAt IS NULL) OR (status <> 'running' AND endedAt IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS sequence_run_entries (
      runId TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      sessionId TEXT NOT NULL UNIQUE,
      configId TEXT NOT NULL,
      configName TEXT NOT NULL,
      config TEXT NOT NULL CHECK (json_valid(config) AND json_type(config) = 'object'),
      PRIMARY KEY (runId, position),
      FOREIGN KEY (runId) REFERENCES sequence_runs(runId) ON DELETE RESTRICT,
      FOREIGN KEY (sessionId) REFERENCES sessions(sessionId) ON DELETE RESTRICT,
      FOREIGN KEY (configId) REFERENCES configurations(configId) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_sequence_run_entries_configId
      ON sequence_run_entries(configId);
  `);

  console.log('\u2713 Database tables created');

  // Run migrations for existing databases
  runMigrations();

  // Initialize prepared statements after tables exist
  statements = createStatements();
  console.log('\u2713 Prepared statements ready');
}

// Run any necessary migrations
function runMigrations() {
  // Check if isArchived column exists in configurations table
  const tableInfo = db.prepare("PRAGMA table_info(configurations)").all() as { name: string }[];
  const hasIsArchived = tableInfo.some(col => col.name === 'isArchived');
  
  if (!hasIsArchived) {
    db.exec(`ALTER TABLE configurations ADD COLUMN isArchived INTEGER DEFAULT 0`);
    console.log('\u2713 Added isArchived column to configurations');
  }
}

function createStatements() {
  const sessionColumns = `
    s.*, COALESCE(e.configName, c.name) AS configName,
      e.runId AS sequenceRunId, e.position AS sequencePosition,
      CASE
        WHEN e.runId IS NULL THEN NULL
        WHEN s.endedAt IS NOT NULL THEN 'completed'
        WHEN s.startedAt IS NULL THEN 'planned'
        WHEN r.status = 'interrupted' THEN 'interrupted'
        ELSE 'active'
      END AS sequenceStatus
  `;
  const sessionFrom = `
    FROM sessions s
    JOIN configurations c ON s.configId = c.configId
    LEFT JOIN sequence_run_entries e ON s.sessionId = e.sessionId
    LEFT JOIN sequence_runs r ON e.runId = r.runId
  `;
  const sessionQuery = `SELECT ${sessionColumns} ${sessionFrom}`;
  return {
    // Configurations
    getConfig: db.prepare(`
      SELECT * FROM configurations WHERE configId = ?
    `),

    getAllConfigs: db.prepare(`
      SELECT c.*, COUNT(s.sessionId) as sessionCount
      FROM configurations c
      LEFT JOIN sessions s ON c.configId = s.configId
      WHERE c.isArchived = 0
      GROUP BY c.configId
      ORDER BY c.createdAt DESC
    `),

    getAllConfigsIncludingArchived: db.prepare(`
      SELECT c.*, COUNT(s.sessionId) as sessionCount
      FROM configurations c
      LEFT JOIN sessions s ON c.configId = s.configId
      GROUP BY c.configId
      ORDER BY c.isArchived ASC, c.createdAt DESC
    `),

    getArchivedConfigs: db.prepare(`
      SELECT c.*, COUNT(s.sessionId) as sessionCount
      FROM configurations c
      LEFT JOIN sessions s ON c.configId = s.configId
      WHERE c.isArchived = 1
      GROUP BY c.configId
      ORDER BY c.createdAt DESC
    `),

    insertConfig: db.prepare(`
      INSERT INTO configurations (configId, name, config) VALUES (?, ?, ?)
    `),

    updateConfig: db.prepare(`
      UPDATE configurations SET name = ?, config = ? WHERE configId = ?
    `),

    archiveConfig: db.prepare(`
      UPDATE configurations SET isArchived = 1 WHERE configId = ?
    `),

    unarchiveConfig: db.prepare(`
      UPDATE configurations SET isArchived = 0 WHERE configId = ?
    `),

    deleteConfig: db.prepare(`
      DELETE FROM configurations WHERE configId = ?
    `),

    // Session sequences
    getAllSequences: db.prepare(`
      SELECT * FROM session_sequences ORDER BY createdAt DESC, sequenceId ASC
    `),

    getSequence: db.prepare(`
      SELECT * FROM session_sequences WHERE sequenceId = ?
    `),

    getSequenceEntries: db.prepare(`
      SELECT configId FROM session_sequence_entries WHERE sequenceId = ? ORDER BY position ASC
    `),

    getSequencesByConfig: db.prepare(`
      SELECT DISTINCT s.sequenceId, s.name
      FROM session_sequences s
      JOIN session_sequence_entries e ON s.sequenceId = e.sequenceId
      WHERE e.configId = ?
      ORDER BY s.name ASC, s.sequenceId ASC
    `),

    insertSequence: db.prepare(`
      INSERT INTO session_sequences (sequenceId, name) VALUES (?, ?)
    `),

    updateSequence: db.prepare(`
      UPDATE session_sequences SET name = ? WHERE sequenceId = ?
    `),

    insertSequenceEntry: db.prepare(`
      INSERT INTO session_sequence_entries (sequenceId, position, configId) VALUES (?, ?, ?)
    `),

    deleteSequenceEntries: db.prepare(`
      DELETE FROM session_sequence_entries WHERE sequenceId = ?
    `),

    deleteSequence: db.prepare(`
      DELETE FROM session_sequences WHERE sequenceId = ?
    `),

    // Frozen sequence runs retain their setup identity after setup deletion.
    getAllSequenceRuns: db.prepare(`
      SELECT * FROM sequence_runs ORDER BY julianday(createdAt) DESC, runId ASC
    `),

    getSequenceRun: db.prepare(`
      SELECT * FROM sequence_runs WHERE runId = ?
    `),

    getSequenceRunEntries: db.prepare(`
      SELECT e.position, e.sessionId, e.configId, e.configName, e.config, s.startedAt, s.endedAt
      FROM sequence_run_entries e
      JOIN sessions s ON s.sessionId = e.sessionId
      WHERE e.runId = ? ORDER BY e.position ASC
    `),

    getSequenceRunMember: db.prepare(`
      SELECT e.runId, e.position, s.startedAt, r.status, r.currentPosition, r.sequenceBalance
      FROM sequence_run_entries e
      JOIN sessions s ON s.sessionId = e.sessionId
      JOIN sequence_runs r ON r.runId = e.runId
      WHERE e.sessionId = ?
    `),

    getSequenceRunsByConfig: db.prepare(`
      SELECT DISTINCT r.runId, r.sequenceId, r.sequenceName
      FROM sequence_runs r
      JOIN sequence_run_entries e ON r.runId = e.runId
      WHERE e.configId = ?
      ORDER BY r.createdAt ASC, r.runId ASC
    `),

    insertSequenceRun: db.prepare(`
      INSERT INTO sequence_runs (runId, sequenceId, sequenceName, participantId, sequenceBalance)
      VALUES (?, ?, ?, ?, ?)
    `),

    insertSequenceRunEntry: db.prepare(`
      INSERT INTO sequence_run_entries (runId, position, sessionId, configId, configName, config)
      VALUES (?, ?, ?, ?, ?, ?)
    `),

    addSequenceRunReward: db.prepare(`
      UPDATE sequence_runs SET sequenceBalance = sequenceBalance + ? WHERE runId = ?
    `),

    advanceSequenceRun: db.prepare(`
      UPDATE sequence_runs SET currentPosition = ?, status = ?, endedAt = ? WHERE runId = ?
    `),

    interruptSequenceRun: db.prepare(`
      UPDATE sequence_runs SET status = 'interrupted', endedAt = ?
      WHERE runId = ? AND status = 'running'
    `),

    // Sessions
    getSession: db.prepare(`
      SELECT ${sessionColumns}, COALESCE(e.config, c.config) AS config
      ${sessionFrom} WHERE s.sessionId = ?
    `),

    getAllSessions: db.prepare(`${sessionQuery} ORDER BY julianday(s.startedAt) DESC, s.sessionId ASC`),

    getSessionsByParticipant: db.prepare(`
      ${sessionQuery} WHERE s.participantId = ? ORDER BY julianday(s.startedAt) DESC, s.sessionId ASC
    `),

    getDistinctParticipants: db.prepare(`
      SELECT DISTINCT participantId FROM sessions ORDER BY participantId ASC
    `),

    getParticipantsWithStats: db.prepare(`
      SELECT 
        s.participantId,
        COUNT(*) as sessionCount,
        MAX(strftime('%Y-%m-%dT%H:%M:%fZ', s.startedAt)) as lastSessionDate,
        CASE WHEN ap.participantId IS NOT NULL THEN 1 ELSE 0 END as isArchived
      FROM sessions s
      LEFT JOIN archived_participants ap ON s.participantId = ap.participantId
      WHERE ap.participantId IS NULL
      GROUP BY s.participantId 
      ORDER BY s.participantId ASC
    `),

    getArchivedParticipantsWithStats: db.prepare(`
      SELECT 
        s.participantId,
        COUNT(*) as sessionCount,
        MAX(strftime('%Y-%m-%dT%H:%M:%fZ', s.startedAt)) as lastSessionDate,
        1 as isArchived
      FROM sessions s
      INNER JOIN archived_participants ap ON s.participantId = ap.participantId
      GROUP BY s.participantId 
      ORDER BY s.participantId ASC
    `),

    archiveParticipant: db.prepare(`
      INSERT OR REPLACE INTO archived_participants (participantId) VALUES (?)
    `),

    unarchiveParticipant: db.prepare(`
      DELETE FROM archived_participants WHERE participantId = ?
    `),

    isParticipantArchived: db.prepare(`
      SELECT 1 FROM archived_participants WHERE participantId = ?
    `),

    getMaxSessionIdForParticipant: db.prepare(`
      SELECT COUNT(*) as sessionCount 
      FROM sessions 
      WHERE participantId = ?
    `),

    getSessionsByConfig: db.prepare(`
      ${sessionQuery} WHERE s.configId = ? ORDER BY julianday(s.startedAt) DESC, s.sessionId ASC
    `),

    insertSession: db.prepare(`
      INSERT INTO sessions (sessionId, participantId, configId) VALUES (?, ?, ?)
    `),

    insertPlannedSession: db.prepare(`
      INSERT INTO sessions (sessionId, participantId, configId, startedAt) VALUES (?, ?, ?, NULL)
    `),

    updateSessionStart: db.prepare(`
      UPDATE sessions SET startedAt = ? WHERE sessionId = ?
    `),

    updateSessionEnd: db.prepare(`
      UPDATE sessions SET endedAt = ? WHERE sessionId = ?
    `),

    deleteSession: db.prepare(`
      DELETE FROM sessions WHERE sessionId = ?
    `),

    // Event logging
    insertEvent: db.prepare(`
      INSERT INTO session_event_log (sessionId, event, value, timestamp) 
      VALUES (?, ?, ?, ?)
    `),

    getSessionEvents: db.prepare(`
      SELECT * 
      FROM session_event_log 
      WHERE sessionId = ? 
      ORDER BY timestamp ASC, id ASC
    `),

    getSessionEventByType: db.prepare(`
      SELECT * 
      FROM session_event_log 
      WHERE sessionId = ? AND event = ? 
      ORDER BY timestamp ASC, id ASC
      LIMIT 1
    `),

    getClickEvents: db.prepare(`
      SELECT * 
      FROM session_event_log 
      WHERE sessionId = ? AND event = 'click' 
      ORDER BY timestamp ASC, id ASC
    `),

    getPauseResumeEvents: db.prepare(`
      SELECT *
      FROM session_event_log
      WHERE sessionId = ? AND event IN ('pause', 'resume')
      ORDER BY timestamp ASC, id ASC
    `),

    // Analytics queries
    getSessionStats: db.prepare(`
      SELECT 
        COUNT(*) as totalEvents,
        MIN(timestamp) as startTime,
        MAX(timestamp) as endTime
      FROM session_event_log 
      WHERE sessionId = ? AND event = 'click'
    `),

    getEventCount: db.prepare(`
      SELECT COUNT(*) as count 
      FROM session_event_log 
      WHERE sessionId = ? AND event = ?
    `),

    // Session notes
    getSessionNotes: db.prepare(`
      SELECT * FROM session_notes WHERE sessionId = ?
    `),

    upsertSessionNotes: db.prepare(`
      INSERT INTO session_notes (sessionId, notes, updatedAt)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(sessionId) DO UPDATE SET notes = excluded.notes, updatedAt = CURRENT_TIMESTAMP
    `),
  };
}

// Transaction helpers
export function runInTransaction<T>(fn: () => T): T {
  const transaction = db.transaction(fn);
  return transaction();
}

export function getNextSessionId(participantId: string): string {
  const { sessionCount } = statements.getMaxSessionIdForParticipant.get(participantId) as { sessionCount: number };
  let number = sessionCount + 1;
  while (statements.getSession.get(`${participantId}-${number}`)) number += 1;
  return `${participantId}-${number}`;
}

// Cleanup
export function closeDatabase() {
  db.close();
  console.log('\u2713 Database connection closed');
}

// Handle process termination
process.on('exit', closeDatabase);
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});
