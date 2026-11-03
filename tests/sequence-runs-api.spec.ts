import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

async function createConfiguration(request: APIRequestContext, apiURL: string, name: string, startingMoney = 200, moneyLimit = 500) {
  const configId = `run-${randomUUID()}`;
  const config = {
    timeLimit: 30, moneyLimit, startingMoney, continueAfterMoneyLimit: false,
    inputs: [{
      id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
      isRewarded: true, moneyAwarded: 300, awardInterval: 1, playAwardSound: false,
    }],
  };
  const response = await request.post(`${apiURL}/configurations`, { data: { configId, name, config } });
  expect(response.status()).toBe(201);
  return { configId, name, config };
}

test('launch freezes A B A as three distinct sessions that remain planned until actual start', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Frozen A');
  const b = await createConfiguration(request, app.apiURL, 'Frozen B', 9000);
  const created = await request.post(`${app.apiURL}/sequences`, {
    data: { name: 'Frozen A B A', configIds: [a.configId, b.configId, a.configId] },
  });
  expect(created.status()).toBe(201);
  const { sequenceId } = await created.json();
  const participantId = `participant-${randomUUID()}`;
  const launched = await request.post(`${app.apiURL}/sequences/${sequenceId}/runs`, { data: { participantId } });
  expect(launched.status()).toBe(201);
  const run = await launched.json();
  expect(run).toMatchObject({
    runId: expect.any(String), sequenceId, sequenceName: 'Frozen A B A', participantId,
    status: 'running', currentPosition: 0, sequenceBalance: 200, endedAt: null,
  });
  expect(run.entries).toEqual([
    { position: 0, sessionId: expect.any(String), configId: a.configId, configName: 'Frozen A', config: a.config, startedAt: null, endedAt: null },
    { position: 1, sessionId: expect.any(String), configId: b.configId, configName: 'Frozen B', config: b.config, startedAt: null, endedAt: null },
    { position: 2, sessionId: expect.any(String), configId: a.configId, configName: 'Frozen A', config: a.config, startedAt: null, endedAt: null },
  ]);
  expect(new Set(run.entries.map((entry: { sessionId: string }) => entry.sessionId)).size).toBe(3);
  const retrieved = await request.get(`${app.apiURL}/sequence-runs/${run.runId}`);
  expect(retrieved.status()).toBe(200);
  expect(await retrieved.json()).toEqual(run);
});

async function launchRun(request: APIRequestContext, apiURL: string, configIds: string[], name = 'Ordered research run') {
  const created = await request.post(`${apiURL}/sequences`, { data: { name, configIds } });
  expect(created.status()).toBe(201);
  const { sequenceId } = await created.json();
  const launched = await request.post(`${apiURL}/sequences/${sequenceId}/runs`, {
    data: { participantId: `participant-${randomUUID()}` },
  });
  expect(launched.status()).toBe(201);
  return launched.json();
}

async function readRun(request: APIRequestContext, apiURL: string, runId: string) {
  const response = await request.get(`${apiURL}/sequence-runs/${runId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function readData(request: APIRequestContext, apiURL: string, sessionId: string) {
  const response = await request.get(`${apiURL}/sessions/${sessionId}/data`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function logEvent(request: APIRequestContext, apiURL: string, sessionId: string, event: string, value: Record<string, unknown>, timestamp: string) {
  return request.post(`${apiURL}/events`, { data: { sessionId, event, value, timestamp } });
}

test('invalid launch requests create no partial participant sessions', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Launch validation A');
  const created = await request.post(`${app.apiURL}/sequences`, {
    data: { name: 'Validated launch', configIds: [a.configId, a.configId] },
  });
  expect(created.status()).toBe(201);
  const { sequenceId } = await created.json();
  const before = await (await request.get(`${app.apiURL}/sessions`)).json();
  for (const data of [{}, { participantId: '' }, { participantId: '   ' }, { participantId: 42 }, { participantId: 'x'.repeat(101) }]) {
    const rejected = await request.post(`${app.apiURL}/sequences/${sequenceId}/runs`, { data });
    expect(rejected.status(), JSON.stringify(data)).toBe(400);
  }
  const missing = await request.post(`${app.apiURL}/sequences/missing-sequence/runs`, { data: { participantId: 'Missing-sequence-participant' } });
  expect(missing.status()).toBe(404);
  expect((await request.get(`${app.apiURL}/sequence-runs/missing-run`)).status()).toBe(404);
  expect(await (await request.get(`${app.apiURL}/sessions`)).json()).toEqual(before);
});

test('only the current started entry accepts events and each completion advances exactly once', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Ordered A');
  const b = await createConfiguration(request, app.apiURL, 'Ordered B', 1000, 1300);
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
  const [first, second] = run.entries as { sessionId: string }[];
  const startA = { moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false };
  const clickA = {
    inputId: 'reward', inputName: 'Reward', clicks: { reward: 1 }, totalClicks: 1,
    moneyCounter: 500, awardedCents: 300, moneyLimitReached: true, timeLimitReached: false,
    codWithheld: false, codPending: 0,
  };
  const endA = {
    moneyCounter: 500, moneyLimitReached: true, timeLimitReached: false,
    clicks: { reward: 1 }, totalClicks: 1, pendingRewards: { reward: 0 },
  };
  for (const event of ['click', 'pause', 'resume']) {
    expect((await logEvent(request, app.apiURL, first.sessionId, event, clickA, '2026-10-30T10:00:00.000Z')).status()).toBe(409);
  }
  expect((await request.post(`${app.apiURL}/sessions/${first.sessionId}/end`, {
    data: { value: endA, timestamp: '2026-10-30T10:00:00.000Z' },
  })).status()).toBe(409);
  expect((await logEvent(request, app.apiURL, second.sessionId, 'start', startA, '2026-10-30T10:00:00.000Z')).status()).toBe(409);
  expect((await logEvent(request, app.apiURL, first.sessionId, 'start', startA, '2026-10-30T10:00:00.000Z')).status()).toBe(201);
  expect((await logEvent(request, app.apiURL, first.sessionId, 'start', startA, '2026-10-30T10:00:01.000Z')).status()).toBe(409);
  expect((await logEvent(request, app.apiURL, first.sessionId, 'click', clickA, '2026-10-30T10:00:01.000Z')).status()).toBe(201);
  const endedA = await request.post(`${app.apiURL}/sessions/${first.sessionId}/end`, {
    data: { value: endA, timestamp: '2026-10-30T10:00:02.000Z' },
  });
  expect(endedA.status()).toBe(200);
  expect((await endedA.json()).run).toMatchObject({ status: 'running', currentPosition: 1, sequenceBalance: 500 });
  expect((await logEvent(request, app.apiURL, first.sessionId, 'click', clickA, '2026-10-30T10:00:03.000Z')).status()).toBe(409);
  expect((await request.post(`${app.apiURL}/sessions/${first.sessionId}/end`, {
    data: { value: endA, timestamp: '2026-10-30T10:00:03.000Z' },
  })).status()).toBe(409);
  expect((await logEvent(request, app.apiURL, second.sessionId, 'start', { ...startA, moneyCounter: 1000 }, '2026-10-30T10:00:03.000Z')).status()).toBe(201);
  expect((await logEvent(request, app.apiURL, second.sessionId, 'click', { ...clickA, moneyCounter: 1300 }, '2026-10-30T10:00:04.000Z')).status()).toBe(201);
  const endedB = await request.post(`${app.apiURL}/sessions/${second.sessionId}/end`, {
    data: { value: { ...endA, moneyCounter: 1300 }, timestamp: '2026-10-30T10:00:05.000Z' },
  });
  expect(endedB.status()).toBe(200);
  expect((await endedB.json()).run).toMatchObject({ status: 'completed', currentPosition: 2, sequenceBalance: 800 });
  const completed = await readRun(request, app.apiURL, run.runId);
  expect(completed).toMatchObject({
    status: 'completed', currentPosition: 2, sequenceBalance: 800, endedAt: '2026-10-30T10:00:05.000Z',
  });
  expect(completed.entries.map((entry: { startedAt: string; endedAt: string }) => [entry.startedAt, entry.endedAt])).toEqual([
    ['2026-10-30T10:00:00.000Z', '2026-10-30T10:00:02.000Z'],
    ['2026-10-30T10:00:03.000Z', '2026-10-30T10:00:05.000Z'],
  ]);
  expect((await readData(request, app.apiURL, first.sessionId)).allClicks).toHaveLength(1);
  expect((await readData(request, app.apiURL, second.sessionId)).allClicks).toHaveLength(1);
  const sessions = await (await request.get(`${app.apiURL}/sessions`)).json();
  expect(sessions.find((row: { sessionId: string }) => row.sessionId === first.sessionId)).toMatchObject({
    finalMoney: 500, totalClicks: 1, sequenceRunId: run.runId, sequencePosition: 0, sequenceStatus: 'completed',
  });
  expect(sessions.find((row: { sessionId: string }) => row.sessionId === second.sessionId)).toMatchObject({ finalMoney: 1300, totalClicks: 1 });
  const interrupted = await request.post(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`);
  expect(interrupted.status()).toBe(200);
  expect(await interrupted.json()).toEqual(completed);
  expect((await request.delete(`${app.apiURL}/sequences/${run.sequenceId}`)).status()).toBe(200);
  expect((await request.delete(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(409);
  expect((await request.delete(`${app.apiURL}/configurations/${b.configId}`)).status()).toBe(409);
  expect((await request.delete(`${app.apiURL}/sessions/${second.sessionId}`)).status()).toBe(409);
});

test('prepared history entries stay planned and interruption never invents a successful end', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Interrupted A');
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId, a.configId]);
  const [first, second, third] = run.entries as { sessionId: string }[];
  let sessions = await (await request.get(`${app.apiURL}/sessions`)).json();
  for (const entry of [first, second, third]) {
    expect(sessions.find((row: { sessionId: string }) => row.sessionId === entry.sessionId)).toMatchObject({
      startedAt: null, endedAt: null, sequenceStatus: 'planned', totalClicks: 0, finalMoney: null,
    });
  }
  expect((await logEvent(request, app.apiURL, first.sessionId, 'start', {
    moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false,
  }, '2026-10-30T11:00:00.000Z')).status()).toBe(201);
  const interrupted = await request.post(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`);
  expect(interrupted.status()).toBe(200);
  expect(await interrupted.json()).toMatchObject({ status: 'interrupted', currentPosition: 0, sequenceBalance: 200, endedAt: expect.any(String) });
  sessions = await (await request.get(`${app.apiURL}/sessions`)).json();
  expect(sessions.find((row: { sessionId: string }) => row.sessionId === first.sessionId)).toMatchObject({
    startedAt: '2026-10-30T11:00:00.000Z', endedAt: null, sequenceStatus: 'interrupted', finalMoney: null,
  });
  for (const entry of [second, third]) {
    expect(sessions.find((row: { sessionId: string }) => row.sessionId === entry.sessionId)).toMatchObject({ startedAt: null, endedAt: null, sequenceStatus: 'planned' });
  }
  expect((await logEvent(request, app.apiURL, second.sessionId, 'start', {}, '2026-10-30T11:00:01.000Z')).status()).toBe(409);
  expect((await logEvent(request, app.apiURL, first.sessionId, 'click', {
    inputId: 'reward', awardedCents: 300, totalClicks: 1,
  }, '2026-10-30T11:00:01.000Z')).status()).toBe(409);
  expect((await readData(request, app.apiURL, first.sessionId)).endEvent).toBeNull();
  expect((await readData(request, app.apiURL, second.sessionId)).startEvent).toBeNull();
});

test('frozen conditions and research records survive source edits, setup deletion and deletion attempts', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Retained A');
  const b = await createConfiguration(request, app.apiURL, 'Retained B', 1000, 1300);
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId, a.configId], 'Original frozen order');
  for (const configuration of [a, b]) {
    const edited = await request.put(`${app.apiURL}/configurations/${configuration.configId}`, {
      data: { name: 'Replaced live configuration', config: { ...configuration.config, startingMoney: 0, timeLimit: 999, inputs: [] } },
    });
    expect(edited.status()).toBe(200);
  }
  expect((await request.put(`${app.apiURL}/sequences/${run.sequenceId}`, {
    data: { name: 'Changed setup', configIds: [b.configId] },
  })).status()).toBe(200);
  expect((await request.delete(`${app.apiURL}/sequences/${run.sequenceId}`)).status()).toBe(200);
  expect(await readRun(request, app.apiURL, run.runId)).toEqual(run);
  const [first, second, third] = run.entries as { sessionId: string }[];
  expect((await readData(request, app.apiURL, first.sessionId)).sessionConfig).toEqual(a.config);
  expect((await readData(request, app.apiURL, second.sessionId)).sessionConfig).toEqual(b.config);
  expect((await readData(request, app.apiURL, third.sessionId)).sessionConfig).toEqual(a.config);
  expect((await logEvent(request, app.apiURL, first.sessionId, 'start', {
    moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false,
  }, '2026-10-30T12:00:00.000Z')).status()).toBe(201);
  expect((await logEvent(request, app.apiURL, first.sessionId, 'click', {
    inputId: 'reward', inputName: 'Reward', totalClicks: 1, clicks: { reward: 1 },
    moneyCounter: 500, awardedCents: 300, moneyLimitReached: true, timeLimitReached: false,
  }, '2026-10-30T12:00:01.000Z')).status()).toBe(201);
  expect((await request.post(`${app.apiURL}/sessions/${first.sessionId}/end`, {
    data: {
      value: { moneyCounter: 500, moneyLimitReached: true, timeLimitReached: false, clicks: { reward: 1 }, totalClicks: 1, pendingRewards: { reward: 0 } },
      timestamp: '2026-10-30T12:00:01.000Z',
    },
  })).status()).toBe(200);
  expect((await request.post(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`)).status()).toBe(200);
  expect((await request.put(`${app.apiURL}/sessions/${first.sessionId}/notes`, { data: { notes: 'Preserve researcher observation' } })).status()).toBe(200);
  const before = await readData(request, app.apiURL, first.sessionId);
  for (const entry of [first, second, third]) {
    expect((await request.delete(`${app.apiURL}/sessions/${entry.sessionId}`)).status()).toBe(409);
  }
  expect((await request.delete(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(409);
  expect((await request.delete(`${app.apiURL}/configurations/${b.configId}`)).status()).toBe(409);
  expect(await readData(request, app.apiURL, first.sessionId)).toEqual(before);
  expect(await (await request.get(`${app.apiURL}/sessions/${first.sessionId}/notes`)).json()).toMatchObject({ notes: 'Preserve researcher observation' });
  expect(await readRun(request, app.apiURL, run.runId)).toMatchObject({ sequenceId: run.sequenceId, sequenceName: 'Original frozen order', currentPosition: 1, status: 'interrupted' });
});

test('a later prepared-session insert failure rolls back the whole launch', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Atomic launch');
  const created = await request.post(`${app.apiURL}/sequences`, { data: { name: 'Atomic preparation', configIds: [a.configId, a.configId, a.configId] } });
  expect(created.status()).toBe(201);
  const { sequenceId } = await created.json();
  const participantId = `rollback-${randomUUID()}`;
  const before = await (await request.get(`${app.apiURL}/sessions`)).json();
  const database = new Database(app.databasePath);
  const trigger = `fail_launch_${randomUUID().replaceAll('-', '')}`;
  try {
    // Fail after the first prepared session; all earlier inserts must roll back too.
    database.exec(`
      CREATE TRIGGER ${trigger}
      BEFORE INSERT ON sessions
      WHEN NEW.participantId = '${participantId}'
        AND EXISTS (SELECT 1 FROM sessions WHERE participantId = NEW.participantId)
      BEGIN
        SELECT RAISE(ABORT, 'sequence preparation fixture');
      END;
    `);
    const failed = await request.post(`${app.apiURL}/sequences/${sequenceId}/runs`, { data: { participantId } });
    expect(failed.status()).toBe(500);
    expect(await (await request.get(`${app.apiURL}/sessions`)).json()).toEqual(before);
    expect((await request.delete(`${app.apiURL}/sequences/${sequenceId}`)).status()).toBe(200);
    expect((await request.delete(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(200);
  } finally {
    try {
      database.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    } finally {
      database.close();
    }
  }
});

test('failed end transaction retains the saved click without advancing or fabricating completion', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Atomic run completion');
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
  const first = run.entries[0];
  expect((await logEvent(request, app.apiURL, first.sessionId, 'start', {
    moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false,
  }, '2026-10-30T13:00:00.000Z')).status()).toBe(201);
  expect((await logEvent(request, app.apiURL, first.sessionId, 'click', {
    inputId: 'reward', inputName: 'Reward', totalClicks: 1, awardedCents: 300, moneyCounter: 500,
  }, '2026-10-30T13:00:01.000Z')).status()).toBe(201);
  const database = new Database(app.databasePath);
  const trigger = `fail_run_end_${randomUUID().replaceAll('-', '')}`;
  try {
    // ABORT stops the metadata update; the transaction must undo its preceding end event.
    database.exec(`
      CREATE TRIGGER ${trigger}
      BEFORE UPDATE OF endedAt ON sessions
      WHEN NEW.sessionId = '${first.sessionId}' AND NEW.endedAt IS NOT NULL
        AND EXISTS (SELECT 1 FROM session_event_log WHERE sessionId = NEW.sessionId AND event = 'end')
      BEGIN
        SELECT RAISE(ABORT, 'sequence completion fixture');
      END;
    `);
    const failed = await request.post(`${app.apiURL}/sessions/${first.sessionId}/end`, {
      data: {
        value: { moneyCounter: 500, moneyLimitReached: true, timeLimitReached: false, clicks: { reward: 1 }, totalClicks: 1, pendingRewards: { reward: 0 } },
        timestamp: '2026-10-30T13:00:01.000Z',
      },
    });
    expect(failed.status()).toBe(500);
    const data = await readData(request, app.apiURL, first.sessionId);
    expect(data.endEvent).toBeNull();
    expect(data.allClicks).toHaveLength(1);
    expect(await readRun(request, app.apiURL, run.runId)).toMatchObject({
      status: 'running', currentPosition: 0, sequenceBalance: 500, endedAt: null,
      entries: [
        { endedAt: null, startedAt: '2026-10-30T13:00:00.000Z' },
        { endedAt: null, startedAt: null },
      ],
    });
    expect((await request.post(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`)).status()).toBe(200);
    expect((await readData(request, app.apiURL, first.sessionId)).endEvent).toBeNull();
  } finally {
    try {
      database.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    } finally {
      database.close();
    }
  }
});

test('a failed balance write rolls back its accepted click rather than retaining an unpaid research response', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Atomic click reward');
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
  const firstId = run.entries[0].sessionId;
  expect((await logEvent(request, app.apiURL, firstId, 'start', {
    moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false,
  }, '2026-10-30T15:00:00.000Z')).status()).toBe(201);
  const database = new Database(app.databasePath);
  const trigger = `fail_run_reward_${randomUUID().replaceAll('-', '')}`;
  try {
    // Abort the balance update after click insertion; both writes belong to one transaction.
    database.exec(`
      CREATE TRIGGER ${trigger}
      BEFORE UPDATE OF sequenceBalance ON sequence_runs
      WHEN NEW.runId = '${run.runId}'
      BEGIN
        SELECT RAISE(ABORT, 'sequence reward fixture');
      END;
    `);
    const failed = await logEvent(request, app.apiURL, firstId, 'click', {
      inputId: 'reward', inputName: 'Reward', totalClicks: 1, clicks: { reward: 1 },
      awardedCents: 300, moneyCounter: 500, moneyLimitReached: true, timeLimitReached: false,
    }, '2026-10-30T15:00:01.000Z');
    expect(failed.status()).toBe(500);
    const data = await readData(request, app.apiURL, firstId);
    expect(data.allClicks).toEqual([]);
    expect(data.endEvent).toBeNull();
    const events = await request.get(`${app.apiURL}/events/${firstId}`);
    expect(events.status()).toBe(200);
    expect((await events.json()).map((event: { event: string }) => event.event)).toEqual(['start']);
    expect(await readRun(request, app.apiURL, run.runId)).toMatchObject({
      status: 'running', currentPosition: 0, sequenceBalance: 200, endedAt: null,
    });
  } finally {
    try {
      database.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    } finally {
      database.close();
    }
  }
});

test('mixed legacy and sequence timestamps sort by actual chronology with planned sessions last', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Mixed timestamp history');
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
  const standalone = await request.post(`${app.apiURL}/sessions/start`, {
    data: { participantId: run.participantId, configId: a.configId },
  });
  expect(standalone.status()).toBe(201);
  const { sessionId: standaloneId } = await standalone.json();
  const database = new Database(app.databasePath);
  try {
    // Establish an existing SQLite-format timestamp; all observable assertions use public APIs.
    database.prepare('UPDATE sessions SET startedAt = ? WHERE sessionId = ?').run('2026-10-30 12:00:00', standaloneId);
  } finally {
    database.close();
  }
  expect((await logEvent(request, app.apiURL, run.entries[0].sessionId, 'start', {
    moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false,
  }, '2026-10-30T11:00:00.000Z')).status()).toBe(201);
  for (const url of [
    `${app.apiURL}/sessions`,
    `${app.apiURL}/participants/${run.participantId}/sessions`,
    `${app.apiURL}/configurations/${a.configId}/sessions`,
  ]) {
    const response = await request.get(url);
    expect(response.status()).toBe(200);
    const sessions: { sessionId: string; participantId: string; startedAt: string | null; sequenceStatus?: string }[] = await response.json();
    const participantSessions = sessions.filter(session => session.participantId === run.participantId);
    expect(participantSessions.map(session => ({ sessionId: session.sessionId, startedAt: session.startedAt })), url).toEqual([
      { sessionId: standaloneId, startedAt: '2026-10-30 12:00:00' },
      { sessionId: run.entries[0].sessionId, startedAt: '2026-10-30T11:00:00.000Z' },
      { sessionId: run.entries[1].sessionId, startedAt: null },
    ]);
    expect(participantSessions[2].sequenceStatus).toBe('planned');
  }
  const participants = await request.get(`${app.apiURL}/participants`);
  expect(participants.status()).toBe(200);
  const participant = (await participants.json()).find((row: { participantId: string }) => row.participantId === run.participantId);
  expect(participant).toMatchObject({ lastSessionDate: expect.any(String) });
  const normalizedDate = participant.lastSessionDate.replace(' ', 'T');
  const utcDate = normalizedDate.endsWith('Z') ? normalizedDate : `${normalizedDate}Z`;
  expect(new Date(utcDate).toISOString()).toBe('2026-10-30T12:00:00.000Z');
});
