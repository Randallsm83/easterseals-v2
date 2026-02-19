#!/usr/bin/env npx tsx
/**
 * Migration script: Old easterseals app -> v2
 * 
 * Old schema:
 *   session_configuration: configId TEXT PK, config TEXT (JSON)
 *   session_event_log: participantId, sessionId, configId, event, value, timestamp
 * 
 * New schema:
 *   configurations: configId TEXT PK, name TEXT, config TEXT (JSON), createdAt
 *   sessions: sessionId TEXT PK, participantId, configId, startedAt, endedAt
 *   session_event_log: id, sessionId, event, value, timestamp
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const OLD_DB_PATH = process.argv[2] || join(__dirname, '../old-es.db');
const NEW_DB_PATH = process.argv[3] || join(__dirname, '../server/data/easterseals.db');

console.log('Migration: Old Easterseals -> v2');
console.log('================================');
console.log(`Old DB: ${OLD_DB_PATH}`);
console.log(`New DB: ${NEW_DB_PATH}`);
console.log('');

// Open databases
const oldDb = new Database(OLD_DB_PATH, { readonly: true });
const newDb = new Database(NEW_DB_PATH);

newDb.pragma('foreign_keys = ON');
newDb.pragma('journal_mode = WAL');

// Create tables if they don't exist
newDb.exec(`
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

// Read old data
interface OldConfig {
  configId: string;
  config: string;
}

interface OldEvent {
  participantId: string;
  sessionId: string;
  configId: string;
  event: string;
  value: string;
  timestamp: string;
}

const oldConfigs = oldDb.prepare('SELECT * FROM session_configuration').all() as OldConfig[];
const oldEvents = oldDb.prepare('SELECT * FROM session_event_log ORDER BY timestamp ASC').all() as OldEvent[];

console.log(`Found ${oldConfigs.length} configurations`);
console.log(`Found ${oldEvents.length} events`);
console.log('');

// Migrate configurations
const insertConfig = newDb.prepare(`
  INSERT OR REPLACE INTO configurations (configId, name, config, createdAt) 
  VALUES (?, ?, ?, datetime('now'))
`);

let configCount = 0;
for (const oldConfig of oldConfigs) {
  try {
    const configData = JSON.parse(oldConfig.config);
    // Use configId as name if no name field
    const name = configData.name || `Config ${oldConfig.configId}`;
    
    // Transform config to new format - use parseFloat for decimal cents
    // Note: old app stored numbers as strings, and checkboxes as 'on'/undefined
    const rawButtonActive = configData.buttonActive;
    const newConfig = {
      timeLimit: parseFloat(configData.timeLimit) || 60,
      moneyAwarded: parseFloat(configData.moneyAwarded) || 0,
      moneyLimit: parseFloat(configData.moneyLimit) || 100,
      startingMoney: parseFloat(configData.startingMoney) || 0,
      awardInterval: parseFloat(configData.awardInterval) || 10,
      playAwardSound: configData.playAwardSound === 'on' || configData.playAwardSound === true,
      continueAfterMoneyLimit: configData.continueAfterMoneyLimit === 'on' || configData.continueAfterMoneyLimit === true,
      buttonActive: (rawButtonActive && rawButtonActive !== 'none') ? rawButtonActive : null,
      leftButton: {
        shape: configData.leftButtonShape || 'rectangle',
        color: configData.leftButtonColor || '#36454f'
      },
      middleButton: {
        shape: configData.middleButtonShape || 'rectangle',
        color: configData.middleButtonColor || '#36454f'
      },
      rightButton: {
        shape: configData.rightButtonShape || 'rectangle',
        color: configData.rightButtonColor || '#36454f'
      }
    };

    insertConfig.run(oldConfig.configId, name, JSON.stringify(newConfig));
    configCount++;
  } catch (err) {
    console.error(`Failed to migrate config ${oldConfig.configId}:`, err);
  }
}
console.log(`✓ Migrated ${configCount} configurations`);

// Build unique sessions from events
const sessionMap = new Map<string, { participantId: string; configId: string; startTime: string | null; endTime: string | null }>();

for (const event of oldEvents) {
  // In old schema, sessionId is per-participant (1, 2, 3...)
  // Create composite key: participantId-sessionId
  const compositeSessionId = `${event.participantId}-${event.sessionId}`;
  
  if (!sessionMap.has(compositeSessionId)) {
    sessionMap.set(compositeSessionId, {
      participantId: event.participantId,
      configId: event.configId,
      startTime: null,
      endTime: null
    });
  }
  
  const session = sessionMap.get(compositeSessionId)!;
  
  if (event.event === 'start' && !session.startTime) {
    session.startTime = event.timestamp;
  }
  if (event.event === 'end') {
    session.endTime = event.timestamp;
  }
}

// Migrate sessions
const insertSession = newDb.prepare(`
  INSERT OR REPLACE INTO sessions (sessionId, participantId, configId, startedAt, endedAt) 
  VALUES (?, ?, ?, ?, ?)
`);

let sessionCount = 0;
for (const [sessionId, session] of sessionMap) {
  try {
    // Check if config exists
    const configExists = newDb.prepare('SELECT 1 FROM configurations WHERE configId = ?').get(session.configId);
    if (!configExists) {
      console.warn(`  Skipping session ${sessionId}: config ${session.configId} not found`);
      continue;
    }
    
    insertSession.run(
      sessionId,
      session.participantId,
      session.configId,
      session.startTime || new Date().toISOString(),
      session.endTime
    );
    sessionCount++;
  } catch (err) {
    console.error(`Failed to migrate session ${sessionId}:`, err);
  }
}
console.log(`✓ Migrated ${sessionCount} sessions`);

// Migrate events
const insertEvent = newDb.prepare(`
  INSERT INTO session_event_log (sessionId, event, value, timestamp) 
  VALUES (?, ?, ?, ?)
`);

let eventCount = 0;
const migrateEvents = newDb.transaction(() => {
  for (const event of oldEvents) {
    const compositeSessionId = `${event.participantId}-${event.sessionId}`;
    
    // Check if session was migrated
    const sessionExists = newDb.prepare('SELECT 1 FROM sessions WHERE sessionId = ?').get(compositeSessionId);
    if (!sessionExists) continue;
    
    try {
      insertEvent.run(
        compositeSessionId,
        event.event,
        event.value || '{}',
        event.timestamp
      );
      eventCount++;
    } catch (err) {
      // Skip duplicate events
    }
  }
});

migrateEvents();
console.log(`✓ Migrated ${eventCount} events`);

// Close databases
oldDb.close();
newDb.close();

console.log('');
console.log('Migration complete!');
