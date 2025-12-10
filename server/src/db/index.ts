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
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
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
  `);

  console.log('\u2713 Database tables created');

  // Initialize prepared statements after tables exist
  statements = createStatements();
  console.log('\u2713 Prepared statements ready');
}

function createStatements() {
  return {
    // Configurations
    getConfig: db.prepare(`
      SELECT * FROM configurations WHERE configId = ?
    `),

    getAllConfigs: db.prepare(`
      SELECT * FROM configurations ORDER BY createdAt DESC
    `),

    insertConfig: db.prepare(`
      INSERT INTO configurations (configId, name, config) VALUES (?, ?, ?)
    `),

    updateConfig: db.prepare(`
      UPDATE configurations SET name = ?, config = ? WHERE configId = ?
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
