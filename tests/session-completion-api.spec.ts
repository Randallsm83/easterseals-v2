import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { test as base, expect } from './fixtures';

const startedAt = '2026-10-30T09:00:00.000Z';
const clickedAt = '2026-10-30T09:00:01.000Z';
const endedAt = '2026-10-30T09:00:02.000Z';
const startValue = { moneyCounter: 10, moneyLimitReached: false, timeLimitReached: false };
const endValue = {
  moneyCounter: 50,
  moneyLimitReached: true,
  timeLimitReached: false,
  clicks: { reward: 1 },
  totalClicks: 1,
  pendingRewards: { reward: 2 },
};
const clickValue = {
  inputId: 'reward',
  inputName: 'Reward',
  ...endValue,
  awardedCents: 40,
  codWithheld: false,
  codPending: 2,
};

type SessionOutcome = {
  data: { startEvent: unknown; endEvent: unknown; allClicks: unknown[]; pauseEvents: unknown[] };
  events: unknown[];
  session: unknown;
};

const test = base.extend<{ sessionId: string }>({
  sessionId: async ({ request, app }, use) => {
    const configId = `completion-api-${randomUUID()}`;
    const created = await request.post(`${app.apiURL}/configurations`, {
      data: {
        configId,
        name: 'Atomic completion API',
        config: {
          timeLimit: 120,
          moneyLimit: 50,
          startingMoney: 10,
          continueAfterMoneyLimit: false,
          inputs: [{
            id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
            isRewarded: true, moneyAwarded: 40, awardInterval: 1, rewardSchedule: 'fixed',
            playAwardSound: false,
          }],
        },
      },
    });
    expect(created.status()).toBe(201);
    const started = await request.post(`${app.apiURL}/sessions/start`, {
      data: { participantId: `participant-${randomUUID()}`, configId },
    });
    expect(started.status()).toBe(201);
    const { sessionId } = await started.json();
    for (const event of [
      { event: 'start', value: startValue, timestamp: startedAt },
      { event: 'click', value: clickValue, timestamp: clickedAt },
    ]) {
      const logged = await request.post(`${app.apiURL}/events`, { data: { sessionId, ...event } });
      expect(logged.status()).toBe(201);
    }
    await use(sessionId);
  },
});

async function readOutcome(request: APIRequestContext, apiURL: string, sessionId: string) {
  const data = await request.get(`${apiURL}/sessions/${sessionId}/data`);
  expect(data.status()).toBe(200);
  const events = await request.get(`${apiURL}/events/${sessionId}`);
  expect(events.status()).toBe(200);
  const sessions = await request.get(`${apiURL}/sessions`);
  expect(sessions.status()).toBe(200);
  return {
    data: await data.json(),
    events: (await events.json()).map((event: { event: string; timestamp: string; value: string }) => ({
      event: event.event, timestamp: event.timestamp, value: JSON.parse(event.value),
    })),
    session: (await sessions.json()).find((session: { sessionId: string }) => session.sessionId === sessionId),
  };
}

function expectExistingClick(data: SessionOutcome['data'], sessionId: string) {
  expect(data.startEvent).toEqual({ sessionId, timestamp: startedAt, value: startValue });
  expect(data.allClicks).toEqual([{
    sessionId,
    timestamp: clickedAt,
    buttonClicked: 'reward',
    inputId: 'reward',
    inputName: 'Reward',
    clickInfo: { total: 1, left: 0, middle: 0, right: 0, awardedCents: 40 },
    sessionInfo: { moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false },
    codWithheld: false,
    codPending: 2,
  }]);
  expect(data.pauseEvents).toEqual([]);
}

function expectUnfinished(outcome: SessionOutcome, sessionId: string) {
  expectExistingClick(outcome.data, sessionId);
  expect(outcome.data.endEvent).toBeNull();
  expect(outcome.session).toMatchObject({ sessionId, endedAt: null, totalClicks: 1, finalMoney: null, duration: null });
  expect(outcome.events).toEqual([
    { event: 'start', timestamp: startedAt, value: startValue },
    { event: 'click', timestamp: clickedAt, value: clickValue },
  ]);
}

function expectCompleted(outcome: SessionOutcome, sessionId: string) {
  expectExistingClick(outcome.data, sessionId);
  expect(outcome.data.endEvent).toEqual({ sessionId, timestamp: endedAt, value: endValue });
  expect(outcome.session).toMatchObject({ sessionId, endedAt, totalClicks: 1, finalMoney: 50, duration: 2 });
  expect(outcome.events).toEqual([
    { event: 'start', timestamp: startedAt, value: startValue },
    { event: 'click', timestamp: clickedAt, value: clickValue },
    { event: 'end', timestamp: endedAt, value: endValue },
  ]);
}

test('unified end persists the current summary and identical event/metadata timestamps', async ({ request, app, sessionId }) => {
  const completed = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
    data: { value: endValue, timestamp: endedAt },
  });
  expect(completed.status()).toBe(200);
  expectCompleted(await readOutcome(request, app.apiURL, sessionId), sessionId);
});

test('duplicate end returns 409 without replacing the original completion', async ({ request, app, sessionId }) => {
  const completed = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
    data: { value: endValue, timestamp: endedAt },
  });
  expect(completed.status()).toBe(200);
  const duplicate = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
    data: {
      value: { moneyCounter: 999, moneyLimitReached: false, timeLimitReached: true, clicks: { reward: 9 }, totalClicks: 9, pendingRewards: { reward: 0 } },
      timestamp: '2026-10-30T09:00:03.000Z',
    },
  });
  expect(duplicate.status()).toBe(409);
  expectCompleted(await readOutcome(request, app.apiURL, sessionId), sessionId);
});

test('late click returns 409 and leaves the completed session unchanged', async ({ request, app, sessionId }) => {
  const completed = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
    data: { value: endValue, timestamp: endedAt },
  });
  expect(completed.status()).toBe(200);
  const late = await request.post(`${app.apiURL}/events`, {
    data: { sessionId, event: 'click', value: clickValue, timestamp: '2026-10-30T09:00:03.000Z' },
  });
  expect(late.status()).toBe(409);
  expectCompleted(await readOutcome(request, app.apiURL, sessionId), sessionId);
});

test('generic end events return 400 without creating completion metadata', async ({ request, app, sessionId }) => {
  const rejected = await request.post(`${app.apiURL}/events`, {
    data: { sessionId, event: 'end', value: endValue, timestamp: endedAt },
  });
  expect(rejected.status()).toBe(400);
  expectUnfinished(await readOutcome(request, app.apiURL, sessionId), sessionId);
});

test('missing required totalClicks returns 400 without creating completion metadata', async ({ request, app, sessionId }) => {
  const value: Partial<typeof endValue> = { ...endValue };
  delete value.totalClicks;
  const rejected = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
    data: { value, timestamp: endedAt },
  });
  expect(rejected.status()).toBe(400);
  expectUnfinished(await readOutcome(request, app.apiURL, sessionId), sessionId);
});

for (const [name, value] of [
  ['negative input clicks', { ...endValue, clicks: { reward: -1 } }],
  ['fractional money', { ...endValue, moneyCounter: 0.5 }],
] as const) {
  test(`${name} returns 400 without creating completion metadata`, async ({ request, app, sessionId }) => {
    const rejected = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
      data: { value, timestamp: endedAt },
    });
    expect(rejected.status()).toBe(400);
    expectUnfinished(await readOutcome(request, app.apiURL, sessionId), sessionId);
  });
}

test('malformed timestamp returns 400 without creating completion metadata', async ({ request, app, sessionId }) => {
  const rejected = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
    data: { value: endValue, timestamp: 'not-a-date' },
  });
  expect(rejected.status()).toBe(400);
  expectUnfinished(await readOutcome(request, app.apiURL, sessionId), sessionId);
});

test('SQLite update failure after end insertion rolls back both completion writes and preserves clicks', async ({ request, app, sessionId }) => {
  const database = new Database(app.databasePath);
  const trigger = `fail_completion_${randomUUID().replaceAll('-', '')}`;
  try {
    // ABORT cancels only the UPDATE statement; the API transaction must also undo the preceding INSERT.
    database.exec(`
      CREATE TRIGGER ${trigger}
      BEFORE UPDATE OF endedAt ON sessions
      WHEN NEW.sessionId = '${sessionId}' AND NEW.endedAt IS NOT NULL
        AND EXISTS (SELECT 1 FROM session_event_log WHERE sessionId = NEW.sessionId AND event = 'end')
      BEGIN
        SELECT RAISE(ABORT, 'completion rollback fixture');
      END;
    `);
    const failed = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
      data: { value: endValue, timestamp: endedAt },
    });
    expect(failed.status()).toBe(500);
    expectUnfinished(await readOutcome(request, app.apiURL, sessionId), sessionId);
  } finally {
    try {
      database.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    } finally {
      database.close();
    }
  }
});
