#!/usr/bin/env node
/**
 * Migration script: Convert old es.db to new schema
 * 
 * Old schema:
 *   session_configuration: configId, config
 *   session_event_log: participantId, sessionId, configId, event, value, timestamp
 * 
 * New schema:
 *   configurations: configId, name, config, createdAt
 *   sessions: sessionId, configId, startedAt, endedAt
 *   session_event_log: id, sessionId, event, value, timestamp
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OLD_DB_PATH = process.argv[2] || join(__dirname, '../old_es.db');
const NEW_DB_PATH = join(__dirname, '../server/data/easterseals.db');

console.log(`Migrating from: ${OLD_DB_PATH}`);
console.log(`Migrating to: ${NEW_DB_PATH}`);

const oldDb = new Database(OLD_DB_PATH, { readonly: true });
const newDb = new Database(NEW_DB_PATH);

// Enable foreign keys
newDb.pragma('foreign_keys = OFF'); // Temporarily disable for migration

try {
  // Start transaction
  newDb.exec('BEGIN TRANSACTION');

  // 1. Migrate configurations
  console.log('\n--- Migrating configurations ---');
  const oldConfigs = oldDb.prepare('SELECT * FROM session_configuration').all();
  console.log(`Found ${oldConfigs.length} configurations`);

  const insertConfig = newDb.prepare(`
    INSERT OR IGNORE INTO configurations (configId, name, config, createdAt) 
    VALUES (?, ?, ?, datetime('now'))
  `);

  for (const config of oldConfigs) {
    // Transform old config field names to new schema
    let configJson;
    try {
      const oldConfig = JSON.parse(config.config);
      configJson = JSON.stringify({
        pointsLimit: oldConfig.moneyLimit ?? oldConfig.pointsLimit,
        sessionLimit: oldConfig.timeLimit ?? oldConfig.sessionLimit,
        endAtLimit: oldConfig.continueAfterMoneyLimit === 'on' ? false : (oldConfig.endAtLimit ?? true),
        buttonActive: oldConfig.buttonActive,
        leftButtonShape: oldConfig.leftButtonShape,
        leftButtonColor: oldConfig.leftButtonColor,
        middleButtonShape: oldConfig.middleButtonShape,
        middleButtonColor: oldConfig.middleButtonColor,
        rightButtonShape: oldConfig.rightButtonShape,
        rightButtonColor: oldConfig.rightButtonColor,
        pointsAwarded: oldConfig.moneyAwarded ?? oldConfig.pointsAwarded,
        clicksNeeded: oldConfig.awardInterval ?? oldConfig.clicksNeeded,
        startingPoints: oldConfig.startingMoney ?? oldConfig.startingPoints,
      });
    } catch {
      configJson = config.config; // Keep original if parsing fails
    }
    
    // Use configId as name since old schema didn't have name
    insertConfig.run(config.configId, config.configId, configJson);
    console.log(`  Migrated config: ${config.configId}`);
  }

  // 2. Extract unique sessions from event log and migrate
  console.log('\n--- Migrating sessions ---');
  const oldSessions = oldDb.prepare(`
    SELECT DISTINCT sessionId, configId, MIN(timestamp) as startedAt, MAX(timestamp) as endedAt
    FROM session_event_log 
    GROUP BY sessionId
  `).all();
  console.log(`Found ${oldSessions.length} sessions`);

  const insertSession = newDb.prepare(`
    INSERT OR IGNORE INTO sessions (sessionId, configId, startedAt, endedAt) 
    VALUES (?, ?, ?, ?)
  `);

  for (const session of oldSessions) {
    insertSession.run(session.sessionId, session.configId, session.startedAt, session.endedAt);
    console.log(`  Migrated session: ${session.sessionId}`);
  }

  // 3. Migrate events
  console.log('\n--- Migrating events ---');
  const oldEvents = oldDb.prepare('SELECT * FROM session_event_log').all();
  console.log(`Found ${oldEvents.length} events`);

  const insertEvent = newDb.prepare(`
    INSERT INTO session_event_log (sessionId, event, value, timestamp) 
    VALUES (?, ?, ?, ?)
  `);

  let migratedEvents = 0;
  for (const event of oldEvents) {
    try {
      insertEvent.run(event.sessionId, event.event, event.value, event.timestamp);
      migratedEvents++;
    } catch (err) {
      console.log(`  Skipped event for session ${event.sessionId}: ${err.message}`);
    }
  }
  console.log(`  Migrated ${migratedEvents} events`);

  // Commit transaction
  newDb.exec('COMMIT');
  console.log('\n✓ Migration complete!');

  // Show summary
  const configCount = newDb.prepare('SELECT COUNT(*) as count FROM configurations').get();
  const sessionCount = newDb.prepare('SELECT COUNT(*) as count FROM sessions').get();
  const eventCount = newDb.prepare('SELECT COUNT(*) as count FROM session_event_log').get();
  
  console.log('\n--- New database summary ---');
  console.log(`Configurations: ${configCount.count}`);
  console.log(`Sessions: ${sessionCount.count}`);
  console.log(`Events: ${eventCount.count}`);

} catch (err) {
  newDb.exec('ROLLBACK');
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  oldDb.close();
  newDb.close();
}
