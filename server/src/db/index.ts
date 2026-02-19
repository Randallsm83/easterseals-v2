import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../../data/easterseals.db');

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

    // Sessions
    getSession: db.prepare(`
      SELECT s.*, c.config 
      FROM sessions s
      JOIN configurations c ON s.configId = c.configId
      WHERE s.sessionId = ?
    `),

    getAllSessions: db.prepare(`
      SELECT s.*, c.name as configName
      FROM sessions s
      JOIN configurations c ON s.configId = c.configId
      ORDER BY s.startedAt DESC
    `),

    getSessionsByParticipant: db.prepare(`
      SELECT s.*, c.name as configName
      FROM sessions s
      JOIN configurations c ON s.configId = c.configId
      WHERE s.participantId = ?
      ORDER BY s.startedAt DESC
    `),

    getDistinctParticipants: db.prepare(`
      SELECT DISTINCT participantId FROM sessions ORDER BY participantId ASC
    `),

    getParticipantsWithStats: db.prepare(`
      SELECT 
        s.participantId,
        COUNT(*) as sessionCount,
        MAX(s.startedAt) as lastSessionDate,
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
        MAX(s.startedAt) as lastSessionDate,
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
      SELECT * FROM sessions WHERE configId = ? ORDER BY startedAt DESC
    `),

    insertSession: db.prepare(`
      INSERT INTO sessions (sessionId, participantId, configId) VALUES (?, ?, ?)
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
      ORDER BY timestamp ASC
    `),

    getSessionEventByType: db.prepare(`
      SELECT * 
      FROM session_event_log 
      WHERE sessionId = ? AND event = ? 
      ORDER BY timestamp ASC 
      LIMIT 1
    `),

    getClickEvents: db.prepare(`
      SELECT * 
      FROM session_event_log 
      WHERE sessionId = ? AND event = 'click' 
      ORDER BY timestamp ASC
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
  };
}

// Transaction helpers
export function runInTransaction<T>(fn: () => T): T {
  const transaction = db.transaction(fn);
  return transaction();
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
