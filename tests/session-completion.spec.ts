import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import type { BaseConfig, InputConfig } from '../client/src/types';

const rewardInput: InputConfig = {
  id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
  isRewarded: true, moneyAwarded: 40, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
};
const keyboardInput: InputConfig = {
  id: 'key', name: 'Keyboard', type: 'keyboard', inputCode: 'KeyK',
  isRewarded: false, moneyAwarded: 0, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function holdFirstClick(page: Page, apiURL: string) {
  const held = deferred();
  const release = deferred();
  await page.route(`${apiURL}/events`, async route => {
    const write = route.request();
    if (write.method() === 'POST') {
      const body = write.postDataJSON();
      if (body.event === 'click' && body.value.totalClicks === 1) {
        held.resolve();
        await release.promise;
      }
    }
    await route.continue();
  });
  return { held, release };
}

async function createSession(request: APIRequestContext, apiURL: string, overrides: Partial<BaseConfig> = {}) {
  const configId = `completion-${randomUUID()}`;
  const created = await request.post(`${apiURL}/configurations`, {
    data: {
      configId, name: 'Completion boundary',
      config: {
        timeLimit: 10, moneyLimit: 50, startingMoney: 10, continueAfterMoneyLimit: false,
        showMoneyToParticipant: true, pauseEnabled: false, changeoverDelayEnabled: false,
        inputs: [rewardInput, keyboardInput], ...overrides,
      },
    },
  });
  expect(created.status()).toBe(201);
  const started = await request.post(`${apiURL}/sessions/start`, {
    data: { participantId: `participant-${randomUUID()}`, configId },
  });
  expect(started.status()).toBe(201);
  return (await started.json()).sessionId as string;
}

async function readSession(request: APIRequestContext, apiURL: string, sessionId: string) {
  const data = await request.get(`${apiURL}/sessions/${sessionId}/data`);
  const events = await request.get(`${apiURL}/events/${sessionId}`);
  const sessions = await request.get(`${apiURL}/sessions`);
  expect(data.status()).toBe(200);
  expect(events.status()).toBe(200);
  expect(sessions.status()).toBe(200);
  return {
    data: await data.json(),
    events: await events.json() as { event: string; value: string; timestamp: string }[],
    session: (await sessions.json()).find((row: { sessionId: string }) => row.sessionId === sessionId),
  };
}

async function freezeClock(page: Page) {
  await page.clock.install({ time: new Date('2025-12-31T23:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00.000Z'));
}

async function openSession(page: Page, sessionId: string, sameDocument = false) {
  if (sameDocument) {
    await page.clock.runFor(20);
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
    // Preserve old in-flight callbacks while exercising standalone SPA navigation.
    await page.evaluate(id => {
      history.pushState({}, '', `/session/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, sessionId);
    await page.clock.runFor(20);
  } else {
    await page.goto(`/session/${sessionId}`);
  }
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
}

function recordWrites(page: Page, apiURL: string) {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (request.url() === `${apiURL}/events`) writes.push(request.postDataJSON().event);
    else if (request.url().startsWith(`${apiURL}/sessions/`) && request.url().endsWith('/end')) writes.push('end');
  });
  return writes;
}

async function clickAndSave(page: Page, apiURL: string, key = false) {
  const saved = page.waitForResponse(response => response.url() === `${apiURL}/events`
    && response.request().method() === 'POST' && response.request().postDataJSON().event === 'click');
  if (key) await page.keyboard.press('KeyK');
  else await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
  expect((await saved).status()).toBe(201);
}

async function attemptStoppedInputs(page: Page) {
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  if (await button.count()) {
    await expect(button).toBeDisabled();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  }
  await page.keyboard.press('KeyK');
  await page.clock.runFor(30_000);
  await page.keyboard.press('KeyK');
}

test('completion waits for the final rewarded click to become durable', async ({ page, request, app }) => {
  const configId = `completion-${randomUUID()}`;
  const configuration = await request.post(`${app.apiURL}/configurations`, {
    data: {
      configId,
      name: 'Completion write barrier',
      config: {
        timeLimit: 120,
        moneyLimit: 50,
        startingMoney: 10,
        continueAfterMoneyLimit: false,
        showMoneyToParticipant: true,
        pauseEnabled: false,
        changeoverDelayEnabled: false,
        inputs: [{
          id: 'reward',
          name: 'Reward',
          type: 'screen',
          shape: 'rectangle',
          color: '#2563eb',
          isRewarded: true,
          moneyAwarded: 40,
          awardInterval: 1,
          rewardSchedule: 'fixed',
          playAwardSound: false,
        }],
      },
    },
  });
  expect(configuration.status()).toBe(201);
  const started = await request.post(`${app.apiURL}/sessions/start`, {
    data: { participantId: `participant-${randomUUID()}`, configId },
  });
  expect(started.status()).toBe(201);
  const { sessionId } = await started.json();

  const releaseClick = deferred();
  let clickHeld = false;
  await page.route(`${app.apiURL}/events`, async route => {
    const request = route.request();
    if (request.method() === 'POST' && request.postDataJSON().event === 'click') {
      clickHeld = true;
      await releaseClick.promise;
    }
    await route.continue();
  });

  try {
    await page.goto(`/session/${sessionId}`);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect.poll(() => clickHeld, { message: 'Final click POST must reach the real HTTP write boundary' }).toBe(true);

    const pendingDataResponse = await request.get(`${app.apiURL}/sessions/${sessionId}/data`);
    expect(pendingDataResponse.ok()).toBe(true);
    const pendingData = await pendingDataResponse.json();
    const pendingListResponse = await request.get(`${app.apiURL}/sessions`);
    expect(pendingListResponse.ok()).toBe(true);
    const pendingList = await pendingListResponse.json();
    const pendingSession = pendingList.find((session: { sessionId: string }) => session.sessionId === sessionId);
    expect(pendingSession).toBeDefined();

    expect.soft(pendingData.endEvent, 'No durable completion before the accepted click is saved').toBeNull();
    expect.soft(pendingData.allClicks).toEqual([]);
    expect.soft(pendingSession.endedAt, 'Session metadata must remain unfinished while the click is held').toBeNull();
    await expect.soft(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeHidden();
    await expect(button).toBeDisabled();

    const clickSaved = page.waitForResponse(response => {
      const write = response.request();
      return response.url() === `${app.apiURL}/events` && write.method() === 'POST' && write.postDataJSON().event === 'click';
    });
    releaseClick.resolve();
    expect((await clickSaved).status()).toBe(201);
    await expect(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeVisible();
    await expect(page.getByText('$0.50 / $0.50', { exact: true })).toBeVisible();

    const completedResponse = await request.get(`${app.apiURL}/sessions/${sessionId}/data`);
    expect(completedResponse.ok()).toBe(true);
    const completed = await completedResponse.json();
    expect(completed.allClicks).toHaveLength(1);
    expect(completed.allClicks[0]).toMatchObject({
      inputId: 'reward',
      clickInfo: { total: 1, awardedCents: 40 },
      sessionInfo: { moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false },
      codWithheld: false,
      codPending: 0,
    });
    expect(completed.endEvent.value).toEqual({
      moneyCounter: 50,
      moneyLimitReached: true,
      timeLimitReached: false,
      clicks: { reward: 1 },
      totalClicks: 1,
      pendingRewards: { reward: 0 },
    });

    const listResponse = await request.get(`${app.apiURL}/sessions`);
    expect(listResponse.ok()).toBe(true);
    const list = await listResponse.json();
    expect(list.find((session: { sessionId: string }) => session.sessionId === sessionId)).toMatchObject({
      endedAt: completed.endEvent.timestamp,
      totalClicks: 1,
      finalMoney: 50,
    });
    const eventsResponse = await request.get(`${app.apiURL}/events/${sessionId}`);
    expect(eventsResponse.ok()).toBe(true);
    const events = await eventsResponse.json();
    expect(events.map((event: { event: string }) => event.event)).toEqual(['start', 'click', 'end']);
    expect(JSON.parse(events[1].value)).toMatchObject({
      clicks: { reward: 1 }, totalClicks: 1, awardedCents: 40, moneyCounter: 50,
    });
    expect(events[2].timestamp).toBe(completed.endEvent.timestamp);
    await expect(button).toBeDisabled();
  } finally {
    releaseClick.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('navigation keeps an old completion snapshot isolated from the new active session', async ({ page, request, app }) => {
  await freezeClock(page);
  const oldId = await createSession(request, app.apiURL);
  const release = deferred();
  const held = deferred();
  await page.route(`${app.apiURL}/events`, async route => {
    const write = route.request();
    const body = write.method() === 'POST' ? write.postDataJSON() : null;
    if (body?.sessionId === oldId && body.event === 'click') {
      held.resolve();
      await release.promise;
    }
    await route.continue();
  });
  try {
    await openSession(page, oldId);
    await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
    await held.promise;
    await expect(page.getByText('Saving session...', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    const newId = await createSession(request, app.apiURL, { startingMoney: 125, moneyLimit: 1000 });
    await openSession(page, newId, true);
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${oldId}/end`);
    release.resolve();
    expect((await ended).status()).toBe(200);
    const old = await readSession(request, app.apiURL, oldId);
    expect(old.data.endEvent.value).toEqual({
      moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false,
      clicks: { reward: 1, key: 0 }, totalClicks: 1, pendingRewards: { reward: 0, key: 0 },
    });
    expect(old.events.map(row => row.event)).toEqual(['start', 'click', 'end']);
    expect(old.session).toMatchObject({ endedAt: old.data.endEvent.timestamp, totalClicks: 1, finalMoney: 50 });
    await expect(page.getByText('$1.25 / $10.00', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
    const saved = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().sessionId === newId && response.request().postDataJSON().event === 'click');
    await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
    expect((await saved).status()).toBe(201);
    const current = await readSession(request, app.apiURL, newId);
    expect(current.data.endEvent).toBeNull();
    expect(current.session).toMatchObject({ endedAt: null, totalClicks: 1, finalMoney: null });
    expect(JSON.parse(current.events[1].value)).toMatchObject({
      clicks: { reward: 1, key: 0 }, totalClicks: 1, moneyCounter: 165, awardedCents: 40,
    });
    await expect(page.getByText('$1.65 / $10.00', { exact: true })).toBeVisible();
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('navigation isolates an old failed click from the new active session', async ({ page, request, app }) => {
  await freezeClock(page);
  const oldId = await createSession(request, app.apiURL);
  const release = deferred();
  const held = deferred();
  await page.route(`${app.apiURL}/events`, async route => {
    const write = route.request();
    const body = write.method() === 'POST' ? write.postDataJSON() : null;
    if (body?.sessionId === oldId && body.event === 'click') {
      held.resolve();
      await release.promise;
      await route.fulfill({ status: 500, json: { error: 'Old click write failed' } });
      return;
    }
    await route.continue();
  });
  try {
    await openSession(page, oldId);
    await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
    await held.promise;
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    const newId = await createSession(request, app.apiURL, { startingMoney: 125, moneyLimit: 1000 });
    await openSession(page, newId, true);
    const failed = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().sessionId === oldId && response.request().postDataJSON().event === 'click');
    release.resolve();
    expect((await failed).status()).toBe(500);
    await page.clock.runFor(100);
    await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
    const saved = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().sessionId === newId && response.request().postDataJSON().event === 'click');
    await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
    expect((await saved).status()).toBe(201);
    const old = await readSession(request, app.apiURL, oldId);
    expect(old.events.map(row => row.event)).toEqual(['start']);
    expect(old.data.endEvent).toBeNull();
    expect(old.session).toMatchObject({ endedAt: null, totalClicks: 0, finalMoney: null });
    const current = await readSession(request, app.apiURL, newId);
    expect(current.events.map(row => row.event)).toEqual(['start', 'click']);
    expect(JSON.parse(current.events[1].value)).toMatchObject({
      clicks: { reward: 1, key: 0 }, totalClicks: 1, moneyCounter: 165, awardedCents: 40,
    });
    expect(current.session).toMatchObject({ endedAt: null, totalClicks: 1, finalMoney: null });
    await expect(page.getByText('$1.65 / $10.00', { exact: true })).toBeVisible();
    await expect(page.getByText(/Session stopped because data could not be saved/)).toBeHidden();
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('completion POST acknowledgement gates success after the triggering click is already durable', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL);
  const writes = recordWrites(page, app.apiURL);
  const held = deferred();
  const release = deferred();
  await page.route(`${app.apiURL}/sessions/${sessionId}/end`, async route => {
    held.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await openSession(page, sessionId);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    await clickAndSave(page, app.apiURL);
    await held.promise;
    await expect(button).toBeDisabled();
    await expect(page.getByText('Saving session...', { exact: true })).toBeVisible();
    await expect(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeHidden();
    const pending = await readSession(request, app.apiURL, sessionId);
    expect(pending.events.map(row => row.event)).toEqual(['start', 'click']);
    expect(JSON.parse(pending.events[1].value)).toEqual({
      inputId: 'reward', inputName: 'Reward', inputType: 'screen',
      clicks: { reward: 1, key: 0 }, totalClicks: 1, awardedCents: 40, moneyCounter: 50,
      moneyLimitReached: true, timeLimitReached: false, codWithheld: false, codPending: 0,
    });
    expect(pending.data.endEvent).toBeNull();
    expect(pending.session).toMatchObject({ endedAt: null, totalClicks: 1, finalMoney: null });
    await attemptStoppedInputs(page);
    expect(writes).toEqual(['start', 'click', 'end']);
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
    release.resolve();
    expect((await ended).status()).toBe(200);
    await expect(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeVisible();
    const completed = await readSession(request, app.apiURL, sessionId);
    expect(completed.data.endEvent.value).toEqual({
      moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false,
      clicks: { reward: 1, key: 0 }, totalClicks: 1, pendingRewards: { reward: 0, key: 0 },
    });
    expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'end']);
    expect(completed.session).toMatchObject({ endedAt: completed.data.endEvent.timestamp, totalClicks: 1, finalMoney: 50 });
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const boundary of [
  { name: 'final', moneyLimit: 50, moneyText: '$0.50 / $0.50' },
  { name: 'nonfinal', moneyLimit: 1000, moneyText: '$0.50 / $10.00' },
]) {
  test(`${boundary.name} accepted click write failure stops input without completion or retry`, async ({ page, request, app }) => {
    await freezeClock(page);
    const sessionId = await createSession(request, app.apiURL, { moneyLimit: boundary.moneyLimit });
    const writes = recordWrites(page, app.apiURL);
    const held = deferred();
    const release = deferred();
    await page.route(`${app.apiURL}/events`, async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON().event === 'click') {
        held.resolve();
        await release.promise;
        await route.fulfill({ status: 500, json: { error: 'Click write failed' } });
      } else {
        await route.continue();
      }
    });
    try {
      await openSession(page, sessionId);
      const button = page.getByRole('button', { name: 'Click Me', exact: true });
      await button.click({ force: true });
      await held.promise;
      await expect(page.getByText(boundary.moneyText, { exact: true })).toBeVisible();
      release.resolve();
      await expect(page.getByText('Session stopped because data could not be saved. Click write failed', { exact: true })).toBeVisible();
      await expect(button).toBeHidden();
      await attemptStoppedInputs(page);
      await expect(page.getByText(/limit reached\. Session ended\./)).toBeHidden();
      expect(writes).toEqual(['start', 'click']);
      const stopped = await readSession(request, app.apiURL, sessionId);
      expect(stopped.data.allClicks).toEqual([]);
      expect(stopped.data.endEvent).toBeNull();
      expect(stopped.events.map(row => row.event)).toEqual(['start']);
      expect(stopped.session).toMatchObject({ endedAt: null, totalClicks: 0, finalMoney: null });
    } finally {
      release.resolve();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

test('completion write failure keeps the durable click but stops input without success or retry', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL);
  const writes = recordWrites(page, app.apiURL);
  await page.route(`${app.apiURL}/sessions/${sessionId}/end`, async route => {
    await route.fulfill({ status: 500, json: { error: 'Completion write failed' } });
  });
  try {
    await openSession(page, sessionId);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    await clickAndSave(page, app.apiURL);
    await expect(page.getByText('Session stopped because data could not be saved. Completion write failed', { exact: true })).toBeVisible();
    await expect(button).toBeHidden();
    await attemptStoppedInputs(page);
    await expect(page.getByText(/limit reached\. Session ended\./)).toBeHidden();
    expect(writes).toEqual(['start', 'click', 'end']);
    const stopped = await readSession(request, app.apiURL, sessionId);
    expect(stopped.events.map(row => row.event)).toEqual(['start', 'click']);
    expect(stopped.data.allClicks).toHaveLength(1);
    expect(stopped.data.allClicks[0]).toMatchObject({
      inputId: 'reward', clickInfo: { total: 1, awardedCents: 40 },
      sessionInfo: { moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false },
      codWithheld: false, codPending: 0,
    });
    expect(stopped.data.endEvent).toBeNull();
    expect(stopped.session).toMatchObject({ endedAt: null, totalClicks: 1, finalMoney: null });
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('time expiry drains a previously accepted click and preserves its pre-expiry snapshot', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL, { moneyLimit: 1000 });
  const writes = recordWrites(page, app.apiURL);
  const held = deferred();
  const release = deferred();
  await page.route(`${app.apiURL}/events`, async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().event === 'click') {
      held.resolve();
      await release.promise;
    }
    await route.continue();
  });
  try {
    await openSession(page, sessionId);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    await button.click({ force: true });
    await held.promise;
    await page.clock.runFor(10_000);
    await expect(button).toBeDisabled();
    await expect(page.getByText('Saving session...', { exact: true })).toBeVisible();
    await expect(page.getByText('Time limit reached. Session ended.', { exact: true })).toBeHidden();
    const pending = await readSession(request, app.apiURL, sessionId);
    expect(pending.data.allClicks).toEqual([]);
    expect(pending.data.endEvent).toBeNull();
    expect(pending.session).toMatchObject({ endedAt: null, totalClicks: 0, finalMoney: null });
    await attemptStoppedInputs(page);
    expect(writes).toEqual(['start', 'click']);
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
    release.resolve();
    expect((await ended).status()).toBe(200);
    await expect(page.getByText('Time limit reached. Session ended.', { exact: true })).toBeVisible();
    const completed = await readSession(request, app.apiURL, sessionId);
    expect(completed.data.endEvent.timestamp).toBe('2026-01-01T00:00:10.000Z');
    expect(completed.data.endEvent.value).toEqual({
      moneyCounter: 50, moneyLimitReached: false, timeLimitReached: true,
      clicks: { reward: 1, key: 0 }, totalClicks: 1, pendingRewards: { reward: 0, key: 0 },
    });
    expect(JSON.parse(completed.events[1].value)).toEqual({
      inputId: 'reward', inputName: 'Reward', inputType: 'screen',
      clicks: { reward: 1, key: 0 }, totalClicks: 1, awardedCents: 40, moneyCounter: 50,
      moneyLimitReached: false, timeLimitReached: false, codWithheld: false, codPending: 0,
    });
    expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'end']);
    expect(completed.session).toMatchObject({ endedAt: '2026-01-01T00:00:10.000Z', totalClicks: 1, finalMoney: 50 });
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('continuation at the money cap accepts screen and keyboard only until time expiry', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL, { continueAfterMoneyLimit: true });
  const writes = recordWrites(page, app.apiURL);
  await openSession(page, sessionId);
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  await clickAndSave(page, app.apiURL);
  await expect(page.getByText('$0.50 / $0.50', { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  await clickAndSave(page, app.apiURL, true);
  await clickAndSave(page, app.apiURL);
  await page.clock.runFor(9_999);
  await expect(button).toBeEnabled();
  const active = await readSession(request, app.apiURL, sessionId);
  expect(active.data.endEvent).toBeNull();
  expect(active.session).toMatchObject({ endedAt: null, totalClicks: 3, finalMoney: null });
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
  await page.clock.runFor(1);
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Time limit reached. Session ended.', { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  await attemptStoppedInputs(page);
  const completed = await readSession(request, app.apiURL, sessionId);
  expect(completed.data.endEvent.value).toEqual({
    moneyCounter: 50, moneyLimitReached: true, timeLimitReached: true,
    clicks: { reward: 2, key: 1 }, totalClicks: 3, pendingRewards: { reward: 0, key: 0 },
  });
  expect(completed.data.allClicks.map((click: { inputId: string; clickInfo: { total: number; awardedCents: number } }) =>
    ({ inputId: click.inputId, total: click.clickInfo.total, awardedCents: click.clickInfo.awardedCents }))).toEqual([
    { inputId: 'reward', total: 1, awardedCents: 40 },
    { inputId: 'key', total: 2, awardedCents: 0 },
    { inputId: 'reward', total: 3, awardedCents: 0 },
  ]);
  expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'click', 'click', 'end']);
  expect(writes).toEqual(['start', 'click', 'click', 'click', 'end']);
  expect(completed.session).toMatchObject({ endedAt: '2026-01-01T00:00:10.000Z', totalClicks: 3, finalMoney: 50 });
});

test('a final rewarded click immediately before time expiry produces one money completion with its final snapshot', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL);
  const writes = recordWrites(page, app.apiURL);
  const held = deferred();
  const release = deferred();
  await page.route(`${app.apiURL}/events`, async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().event === 'click') {
      held.resolve();
      await release.promise;
    }
    await route.continue();
  });
  try {
    await openSession(page, sessionId);
    await page.clock.runFor(9_999);
    await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
    await held.promise;
    await page.clock.runFor(1);
    await expect(page.getByText('Saving session...', { exact: true })).toBeVisible();
    expect(writes).toEqual(['start', 'click']);
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
    release.resolve();
    expect((await ended).status()).toBe(200);
    await expect(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeVisible();
    await page.clock.runFor(30_000);
    const completed = await readSession(request, app.apiURL, sessionId);
    expect(completed.data.endEvent.timestamp).toBe('2026-01-01T00:00:09.999Z');
    expect(completed.data.endEvent.value).toEqual({
      moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false,
      clicks: { reward: 1, key: 0 }, totalClicks: 1, pendingRewards: { reward: 0, key: 0 },
    });
    expect(completed.data.allClicks[0]).toMatchObject({
      inputId: 'reward', clickInfo: { total: 1, awardedCents: 40 },
      sessionInfo: { moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false },
    });
    expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'end']);
    expect(writes).toEqual(['start', 'click', 'end']);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const mode of ['auto', 'manual'] as const) {
  test(`${mode} pause excludes paused time and resumes without counting the resume binding`, async ({ page, request, app }) => {
    await freezeClock(page);
    const sessionId = await createSession(request, app.apiURL, {
      moneyLimit: 1000, pauseEnabled: true, pauseTrigger: 'rewarded', pauseAfterResponses: 1,
      pauseDurationSeconds: 3, pauseResumeMode: mode,
      pauseResumeBinding: { type: 'keyboard', inputCode: 'KeyR', inputLabel: 'R' },
    });
    const writes = recordWrites(page, app.apiURL);
    await openSession(page, sessionId);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    await page.clock.runFor(2_000);
    const paused = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST' && response.request().postDataJSON().event === 'pause');
    await clickAndSave(page, app.apiURL);
    expect((await paused).status()).toBe(201);
    await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
    await expect(button).toBeDisabled();
    if (mode === 'auto') await expect(page.getByText('Resuming in 3s', { exact: true })).toBeVisible();
    else await expect(page.getByText('Press R to resume', { exact: true })).toBeVisible();
    await page.keyboard.press('KeyK');
    await page.clock.runFor(2_999);
    await expect(button).toBeDisabled();
    const duringPause = await readSession(request, app.apiURL, sessionId);
    expect(duringPause.events.map(row => row.event)).toEqual(['start', 'click', 'pause']);
    expect(duringPause.data.endEvent).toBeNull();
    const resumed = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST' && response.request().postDataJSON().event === 'resume');
    await page.clock.runFor(1);
    if (mode === 'manual') {
      await expect(button).toBeDisabled();
      await page.keyboard.press('KeyR');
    }
    expect((await resumed).status()).toBe(201);
    await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeHidden();
    await expect(button).toBeEnabled();
    await clickAndSave(page, app.apiURL, true);
    await page.clock.runFor(7_999);
    await expect(button).toBeEnabled();
    const beforeExpiry = await readSession(request, app.apiURL, sessionId);
    expect(beforeExpiry.data.endEvent).toBeNull();
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
    await page.clock.runFor(1);
    expect((await ended).status()).toBe(200);
    await expect(page.getByText('Time limit reached. Session ended.', { exact: true })).toBeVisible();
    const completed = await readSession(request, app.apiURL, sessionId);
    expect(completed.data.pauseEvents).toEqual([
      { event: 'pause', timestamp: '2026-01-01T00:00:02.000Z' },
      { event: 'resume', timestamp: '2026-01-01T00:00:05.000Z' },
    ]);
    expect(JSON.parse(completed.events[2].value)).toEqual({ moneyCounter: 50, totalClicks: 1 });
    expect(JSON.parse(completed.events[3].value)).toEqual({ moneyCounter: 50, totalClicks: 1 });
    expect(completed.data.endEvent.value).toEqual({
      moneyCounter: 50, moneyLimitReached: false, timeLimitReached: true,
      clicks: { reward: 1, key: 1 }, totalClicks: 2, pendingRewards: { reward: 0, key: 0 },
    });
    expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'pause', 'resume', 'click', 'end']);
    expect(writes).toEqual(['start', 'click', 'pause', 'resume', 'click', 'end']);
    expect(completed.session).toMatchObject({ endedAt: '2026-01-01T00:00:13.000Z', totalClicks: 2, finalMoney: 50 });
  });
}

for (const failedEvent of ['pause', 'resume'] as const) {
  test(`${failedEvent} write failure stops participation and leaves no later resume or completion timer`, async ({ page, request, app }) => {
    await freezeClock(page);
    const sessionId = await createSession(request, app.apiURL, {
      moneyLimit: 1000, pauseEnabled: true, pauseTrigger: 'any', pauseAfterResponses: 1,
      pauseDurationSeconds: 3, pauseResumeMode: 'auto',
    });
    const writes = recordWrites(page, app.apiURL);
    await page.route(`${app.apiURL}/events`, async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON().event === failedEvent) {
        await route.fulfill({ status: 500, json: { error: `${failedEvent} write failed` } });
      } else {
        await route.continue();
      }
    });
    try {
      await openSession(page, sessionId);
      const button = page.getByRole('button', { name: 'Click Me', exact: true });
      const paused = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
        && response.request().method() === 'POST' && response.request().postDataJSON().event === 'pause');
      await clickAndSave(page, app.apiURL);
      expect((await paused).status()).toBe(failedEvent === 'pause' ? 500 : 201);
      if (failedEvent === 'resume') {
        await expect(page.getByText('Resuming in 3s', { exact: true })).toBeVisible();
        await page.clock.runFor(3_000);
      }
      await expect(page.getByText(`Session stopped because data could not be saved. ${failedEvent} write failed`, { exact: true })).toBeVisible();
      await expect(button).toBeHidden();
      await attemptStoppedInputs(page);
      await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeHidden();
      await expect(page.getByText(/limit reached\. Session ended\./)).toBeHidden();
      const stopped = await readSession(request, app.apiURL, sessionId);
      expect(stopped.data.endEvent).toBeNull();
      expect(stopped.session).toMatchObject({ endedAt: null, totalClicks: 1, finalMoney: null });
      expect(stopped.data.allClicks[0]).toMatchObject({
        inputId: 'reward', clickInfo: { total: 1, awardedCents: 40 },
        sessionInfo: { moneyCounter: 50, moneyLimitReached: false, timeLimitReached: false },
        codWithheld: false, codPending: 0,
      });
      if (failedEvent === 'pause') {
        expect(stopped.data.pauseEvents).toEqual([]);
        expect(stopped.events.map(row => row.event)).toEqual(['start', 'click']);
        expect(writes).toEqual(['start', 'click', 'pause']);
      } else {
        expect(stopped.data.pauseEvents).toEqual([{ event: 'pause', timestamp: '2026-01-01T00:00:00.000Z' }]);
        expect(stopped.events.map(row => row.event)).toEqual(['start', 'click', 'pause']);
        expect(writes).toEqual(['start', 'click', 'pause', 'resume']);
      }
    } finally {
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

test('custom reward intervals repeat and the final reward clamps to the cap in the durable snapshot', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL, {
    moneyLimit: 65,
    inputs: [{ ...rewardInput, moneyAwarded: 20, rewardSchedule: 'custom', awardInterval: 2, rewardIntervals: [2, 1] }, keyboardInput],
  });
  await openSession(page, sessionId);
  await clickAndSave(page, app.apiURL);
  await clickAndSave(page, app.apiURL);
  await clickAndSave(page, app.apiURL);
  await clickAndSave(page, app.apiURL);
  await expect(page.getByText('$0.50 / $0.65', { exact: true })).toBeVisible();
  const active = await readSession(request, app.apiURL, sessionId);
  expect(active.data.endEvent).toBeNull();
  expect(active.session).toMatchObject({ endedAt: null, totalClicks: 4, finalMoney: null });
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
  await clickAndSave(page, app.apiURL);
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeVisible();
  await expect(page.getByText('$0.65 / $0.65', { exact: true })).toBeVisible();
  const completed = await readSession(request, app.apiURL, sessionId);
  expect(completed.data.allClicks.map((click: { clickInfo: { total: number; awardedCents: number }; sessionInfo: { moneyCounter: number } }) =>
    ({ total: click.clickInfo.total, awardedCents: click.clickInfo.awardedCents, moneyCounter: click.sessionInfo.moneyCounter }))).toEqual([
    { total: 1, awardedCents: 0, moneyCounter: 10 },
    { total: 2, awardedCents: 20, moneyCounter: 30 },
    { total: 3, awardedCents: 20, moneyCounter: 50 },
    { total: 4, awardedCents: 0, moneyCounter: 50 },
    { total: 5, awardedCents: 15, moneyCounter: 65 },
  ]);
  expect(completed.data.endEvent.value).toEqual({
    moneyCounter: 65, moneyLimitReached: true, timeLimitReached: false,
    clicks: { reward: 5, key: 0 }, totalClicks: 5, pendingRewards: { reward: 0, key: 0 },
  });
  expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'click', 'click', 'click', 'click', 'end']);
  expect(completed.session).toMatchObject({ endedAt: completed.data.endEvent.timestamp, totalClicks: 5, finalMoney: 65 });
});

for (const ending of ['time', 'money'] as const) {
  test(`changeover-delay pending reward survives ${ending} completion with exact final accounting`, async ({ page, request, app }) => {
    await freezeClock(page);
    const sessionId = await createSession(request, app.apiURL, { changeoverDelayEnabled: true, changeoverDelayMs: 1000 });
    await openSession(page, sessionId);
    await clickAndSave(page, app.apiURL, true);
    await clickAndSave(page, app.apiURL);
    const pending = await readSession(request, app.apiURL, sessionId);
    expect(pending.data.endEvent).toBeNull();
    expect(pending.data.allClicks[1]).toMatchObject({
      inputId: 'reward', clickInfo: { total: 2, awardedCents: 0 },
      sessionInfo: { moneyCounter: 10, moneyLimitReached: false, timeLimitReached: false },
      codWithheld: true, codPending: 1,
    });
    await expect(page.getByText('$0.10 / $0.50', { exact: true })).toBeVisible();
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
    if (ending === 'time') {
      await page.clock.runFor(10_000);
    } else {
      await page.clock.runFor(1_000);
      await clickAndSave(page, app.apiURL);
    }
    expect((await ended).status()).toBe(200);
    await expect(page.getByText(ending === 'time'
      ? 'Time limit reached. Session ended.' : 'Money limit reached. Session ended.', { exact: true })).toBeVisible();
    const completed = await readSession(request, app.apiURL, sessionId);
    if (ending === 'time') {
      expect(completed.data.endEvent.value).toEqual({
        moneyCounter: 10, moneyLimitReached: false, timeLimitReached: true,
        clicks: { reward: 1, key: 1 }, totalClicks: 2, pendingRewards: { reward: 1, key: 0 },
      });
      expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'click', 'end']);
      expect(completed.session).toMatchObject({ endedAt: '2026-01-01T00:00:10.000Z', totalClicks: 2, finalMoney: 10 });
    } else {
      expect(completed.data.endEvent.value).toEqual({
        moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false,
        clicks: { reward: 2, key: 1 }, totalClicks: 3, pendingRewards: { reward: 1, key: 0 },
      });
      expect(completed.data.allClicks[2]).toMatchObject({
        inputId: 'reward', clickInfo: { total: 3, awardedCents: 40 },
        sessionInfo: { moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false },
        codWithheld: true, codPending: 1,
      });
      expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'click', 'click', 'end']);
      expect(completed.session).toMatchObject({ endedAt: '2026-01-01T00:00:01.000Z', totalClicks: 3, finalMoney: 50 });
    }
  });
}

test('equal-timestamp accepted clicks persist in acceptance order despite a held first write', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL, {
    inputs: [{ ...rewardInput, awardInterval: 2 }, keyboardInput],
  });
  const writes = recordWrites(page, app.apiURL);
  const { held, release } = await holdFirstClick(page, app.apiURL);
  try {
    await openSession(page, sessionId);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    await button.click({ force: true });
    await held.promise;
    await expect(page.getByText('$0.10 / $0.50', { exact: true })).toBeVisible();
    await expect(button).toBeEnabled();
    // No clock advance or write acknowledgement between accepted responses.
    await button.click({ force: true });
    await expect(page.getByText('$0.50 / $0.50', { exact: true })).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(page.getByText('Saving session...', { exact: true })).toBeVisible();
    const pending = await readSession(request, app.apiURL, sessionId);
    expect.soft(pending.data.allClicks, 'A later response must not become durable ahead of the held first response').toEqual([]);
    expect(pending.data.endEvent).toBeNull();
    expect(pending.session.endedAt).toBeNull();
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
    release.resolve();
    expect((await ended).status()).toBe(200);
    await expect(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeVisible();
    const completed = await readSession(request, app.apiURL, sessionId);
    expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'click', 'end']);
    expect(completed.events.slice(1, 3).map(row => ({
      timestamp: row.timestamp, value: JSON.parse(row.value),
    }))).toEqual([
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        value: {
          inputId: 'reward', inputName: 'Reward', inputType: 'screen',
          clicks: { reward: 1, key: 0 }, totalClicks: 1, awardedCents: 0, moneyCounter: 10,
          moneyLimitReached: false, timeLimitReached: false, codWithheld: false, codPending: 0,
        },
      },
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        value: {
          inputId: 'reward', inputName: 'Reward', inputType: 'screen',
          clicks: { reward: 2, key: 0 }, totalClicks: 2, awardedCents: 40, moneyCounter: 50,
          moneyLimitReached: true, timeLimitReached: false, codWithheld: false, codPending: 0,
        },
      },
    ]);
    expect(completed.data.allClicks.map((click: {
      timestamp: string; clickInfo: { total: number; awardedCents: number }; sessionInfo: { moneyCounter: number };
    }) => ({
      timestamp: click.timestamp, total: click.clickInfo.total,
      awardedCents: click.clickInfo.awardedCents, moneyCounter: click.sessionInfo.moneyCounter,
    }))).toEqual([
      { timestamp: '2026-01-01T00:00:00.000Z', total: 1, awardedCents: 0, moneyCounter: 10 },
      { timestamp: '2026-01-01T00:00:00.000Z', total: 2, awardedCents: 40, moneyCounter: 50 },
    ]);
    expect(completed.data.endEvent.value).toEqual({
      moneyCounter: 50, moneyLimitReached: true, timeLimitReached: false,
      clicks: { reward: 2, key: 0 }, totalClicks: 2, pendingRewards: { reward: 0, key: 0 },
    });
    expect(completed.session).toMatchObject({
      endedAt: '2026-01-01T00:00:00.000Z', totalClicks: 2, finalMoney: 50,
    });
    expect(writes).toEqual(['start', 'click', 'click', 'end']);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('pause threshold blocks input immediately while its accepted click write is held', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL, {
    moneyLimit: 1000, pauseEnabled: true, pauseTrigger: 'any', pauseAfterResponses: 1,
    pauseResumeMode: 'manual',
    pauseResumeBinding: { type: 'keyboard', inputCode: 'KeyR', inputLabel: 'R' },
  });
  const writes = recordWrites(page, app.apiURL);
  const { held, release } = await holdFirstClick(page, app.apiURL);
  try {
    await openSession(page, sessionId);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    const paused = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST' && response.request().postDataJSON().event === 'pause');
    await button.click({ force: true });
    await held.promise;
    await expect.soft(page.getByRole('heading', { name: 'Paused', exact: true }),
      'Pause threshold is based on acceptance, not network acknowledgement').toBeVisible();
    await expect.soft(button).toBeDisabled();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.keyboard.press('KeyK');
    await expect.soft(page.getByText('$0.50 / $10.00', { exact: true })).toBeVisible();
    expect.soft(writes, 'Paused input must not register another response or overtake the held click').toEqual(['start', 'click']);
    const pending = await readSession(request, app.apiURL, sessionId);
    expect(pending.data.allClicks).toEqual([]);
    expect(pending.data.pauseEvents).toEqual([]);
    expect(pending.data.endEvent).toBeNull();
    expect(pending.session).toMatchObject({ endedAt: null, totalClicks: 0, finalMoney: null });

    release.resolve();
    expect((await paused).status()).toBe(201);
    await expect(page.getByText('Press R to resume', { exact: true })).toBeVisible();
    const saved = await readSession(request, app.apiURL, sessionId);
    expect(saved.events.map(row => row.event)).toEqual(['start', 'click', 'pause']);
    expect(saved.data.allClicks).toHaveLength(1);
    expect(saved.data.allClicks[0]).toMatchObject({
      inputId: 'reward', clickInfo: { total: 1, awardedCents: 40 },
      sessionInfo: { moneyCounter: 50, moneyLimitReached: false, timeLimitReached: false },
      codWithheld: false, codPending: 0,
    });
    expect(JSON.parse(saved.events[2].value)).toEqual({ moneyCounter: 50, totalClicks: 1 });

    const resumed = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST' && response.request().postDataJSON().event === 'resume');
    await page.keyboard.press('KeyR');
    expect((await resumed).status()).toBe(201);
    await expect(button).toBeEnabled();
    const afterResume = await readSession(request, app.apiURL, sessionId);
    expect(afterResume.events.map(row => row.event)).toEqual(['start', 'click', 'pause', 'resume']);
    expect(JSON.parse(afterResume.events[3].value)).toEqual({ moneyCounter: 50, totalClicks: 1 });
    expect(afterResume.session).toMatchObject({ endedAt: null, totalClicks: 1, finalMoney: null });

    const pausedAgain = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
      && response.request().method() === 'POST' && response.request().postDataJSON().event === 'pause');
    await clickAndSave(page, app.apiURL);
    expect((await pausedAgain).status()).toBe(201);
    await expect(button).toBeDisabled();
    await expect(page.getByText('$0.90 / $10.00', { exact: true })).toBeVisible();
    const continued = await readSession(request, app.apiURL, sessionId);
    expect(continued.events.map(row => row.event)).toEqual(['start', 'click', 'pause', 'resume', 'click', 'pause']);
    expect(continued.events.filter(row => row.event === 'click').map(row => JSON.parse(row.value))).toEqual([
      {
        inputId: 'reward', inputName: 'Reward', inputType: 'screen',
        clicks: { reward: 1, key: 0 }, totalClicks: 1, awardedCents: 40, moneyCounter: 50,
        moneyLimitReached: false, timeLimitReached: false, codWithheld: false, codPending: 0,
      },
      {
        inputId: 'reward', inputName: 'Reward', inputType: 'screen',
        clicks: { reward: 2, key: 0 }, totalClicks: 2, awardedCents: 40, moneyCounter: 90,
        moneyLimitReached: false, timeLimitReached: false, codWithheld: false, codPending: 0,
      },
    ]);
    expect(JSON.parse(continued.events[5].value)).toEqual({ moneyCounter: 90, totalClicks: 2 });
    expect(continued.data.pauseEvents).toEqual([
      { event: 'pause', timestamp: '2026-01-01T00:00:00.000Z' },
      { event: 'resume', timestamp: '2026-01-01T00:00:00.000Z' },
      { event: 'pause', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(continued.data.endEvent).toBeNull();
    expect(continued.session).toMatchObject({ endedAt: null, totalClicks: 2, finalMoney: null });
    expect(writes).toEqual(['start', 'click', 'pause', 'resume', 'click', 'pause']);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('auto pause resumes three seconds after acceptance while the click write remains held', async ({ page, request, app }) => {
  await freezeClock(page);
  const sessionId = await createSession(request, app.apiURL, {
    moneyLimit: 1000, pauseEnabled: true, pauseTrigger: 'any', pauseAfterResponses: 1,
    pauseDurationSeconds: 3, pauseResumeMode: 'auto',
  });
  const writes = recordWrites(page, app.apiURL);
  const { held, release } = await holdFirstClick(page, app.apiURL);
  try {
    await openSession(page, sessionId);
    const button = page.getByRole('button', { name: 'Click Me', exact: true });
    await button.click({ force: true });
    await held.promise;
    await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
    await expect(button).toBeDisabled();
    await expect.soft(page.getByText('Resuming in 3s', { exact: true }),
      'Auto-pause duration starts when the response is accepted, not when queued writes finish').toBeVisible();
    await page.clock.runFor(2_999);
    await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
    await expect(button).toBeDisabled();
    await page.clock.runFor(1);
    await expect.soft(page.getByRole('heading', { name: 'Paused', exact: true })).toBeHidden();
    await expect.soft(button, 'Participation resumes at +3s even while persistence remains blocked').toBeEnabled();
    const pending = await readSession(request, app.apiURL, sessionId);
    expect(pending.data.allClicks).toEqual([]);
    expect(pending.data.pauseEvents).toEqual([]);
    expect(pending.data.endEvent).toBeNull();
    expect(pending.events.map(row => row.event)).toEqual(['start']);
    expect(pending.session).toMatchObject({ endedAt: null, totalClicks: 0, finalMoney: null });
    expect(writes).toEqual(['start', 'click']);

    release.resolve();
    await expect.poll(async () => {
      const saved = await readSession(request, app.apiURL, sessionId);
      return saved.events.map(row => row.event);
    }).toEqual(['start', 'click', 'pause', 'resume']);
    const resumed = await readSession(request, app.apiURL, sessionId);
    expect(resumed.data.pauseEvents).toEqual([
      { event: 'pause', timestamp: '2026-01-01T00:00:00.000Z' },
      { event: 'resume', timestamp: '2026-01-01T00:00:03.000Z' },
    ]);
    expect(JSON.parse(resumed.events[2].value)).toEqual({ moneyCounter: 50, totalClicks: 1 });
    expect(JSON.parse(resumed.events[3].value)).toEqual({ moneyCounter: 50, totalClicks: 1 });
    expect(resumed.data.allClicks).toHaveLength(1);
    expect(resumed.data.allClicks[0]).toMatchObject({
      inputId: 'reward', timestamp: '2026-01-01T00:00:00.000Z',
      clickInfo: { total: 1, awardedCents: 40 },
      sessionInfo: { moneyCounter: 50, moneyLimitReached: false, timeLimitReached: false },
      codWithheld: false, codPending: 0,
    });
    await expect(button).toBeEnabled();
    await page.clock.runFor(9_999);
    await expect(button).toBeEnabled();
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
    await page.clock.runFor(1);
    expect((await ended).status()).toBe(200);
    await expect(page.getByText('Time limit reached. Session ended.', { exact: true })).toBeVisible();
    const completed = await readSession(request, app.apiURL, sessionId);
    expect(completed.data.endEvent.value).toEqual({
      moneyCounter: 50, moneyLimitReached: false, timeLimitReached: true,
      clicks: { reward: 1, key: 0 }, totalClicks: 1, pendingRewards: { reward: 0, key: 0 },
    });
    expect(completed.events.map(row => row.event)).toEqual(['start', 'click', 'pause', 'resume', 'end']);
    expect(completed.session).toMatchObject({ endedAt: '2026-01-01T00:00:13.000Z', totalClicks: 1, finalMoney: 50 });
    expect(writes).toEqual(['start', 'click', 'pause', 'resume', 'end']);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
