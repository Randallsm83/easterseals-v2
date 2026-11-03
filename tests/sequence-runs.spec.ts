import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import type { BaseConfig, InputConfig, SequenceRun } from '../client/src/types';

const rewardInput: InputConfig = {
  id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
  isRewarded: true, moneyAwarded: 300, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
};
const keyboardInput: InputConfig = {
  id: 'key', name: 'Keyboard', type: 'keyboard', inputCode: 'KeyK',
  isRewarded: false, moneyAwarded: 0, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
};

async function createConfiguration(request: APIRequestContext, apiURL: string, name: string, overrides: Partial<BaseConfig> = {}) {
  const configId = `run-browser-${randomUUID()}`;
  const config: BaseConfig = {
    timeLimit: 30, moneyLimit: 500, startingMoney: 200, continueAfterMoneyLimit: false,
    showMoneyToParticipant: true, pauseEnabled: false, changeoverDelayEnabled: false,
    inputs: [rewardInput, keyboardInput], ...overrides,
  };
  const response = await request.post(`${apiURL}/configurations`, { data: { configId, name, config } });
  expect(response.status()).toBe(201);
  return { configId, name, config };
}

async function saveSequence(request: APIRequestContext, apiURL: string, configIds: string[], name = `Research run ${randomUUID()}`) {
  const response = await request.post(`${apiURL}/sequences`, { data: { name, configIds } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ sequenceId: string; name: string }>;
}

async function launchRun(request: APIRequestContext, apiURL: string, configIds: string[]) {
  const sequence = await saveSequence(request, apiURL, configIds);
  const response = await request.post(`${apiURL}/sequences/${sequence.sequenceId}/runs`, {
    data: { participantId: `participant-${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<SequenceRun>;
}

async function readRun(request: APIRequestContext, apiURL: string, runId: string): Promise<SequenceRun> {
  const response = await request.get(`${apiURL}/sequence-runs/${runId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function readData(request: APIRequestContext, apiURL: string, sessionId: string) {
  const response = await request.get(`${apiURL}/sessions/${sessionId}/data`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function readEvents(request: APIRequestContext, apiURL: string, sessionId: string) {
  const response = await request.get(`${apiURL}/events/${sessionId}`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ event: string; value: string; timestamp: string }[]>;
}

async function freezeClock(page: Page) {
  await page.clock.install({ time: new Date('2025-12-31T23:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00.000Z'));
}

function eventResponse(page: Page, apiURL: string, sessionId: string, event: string) {
  return page.waitForResponse(response => response.url() === `${apiURL}/events`
    && response.request().method() === 'POST'
    && response.request().postDataJSON().sessionId === sessionId
    && response.request().postDataJSON().event === event);
}

async function openRun(page: Page, apiURL: string, run: SequenceRun) {
  const started = eventResponse(page, apiURL, run.entries[0].sessionId, 'start');
  await page.goto(`/sequence-runs/${run.runId}`);
  expect((await started).status()).toBe(201);
  await expect(page.getByRole('group', { name: 'Participant apparatus', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
}

async function clickAndSave(page: Page, apiURL: string, sessionId: string, key = false) {
  const saved = eventResponse(page, apiURL, sessionId, 'click');
  if (key) await page.keyboard.press('KeyK');
  else await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
  expect((await saved).status()).toBe(201);
}

async function expectNoTransitionScreen(page: Page) {
  await expect(page.getByText(/Loading session|Saving session|Session ended|Session complete\.|Starting in|Next condition|Continue to next/i)).toBeHidden();
}

function clickSummary(data: { allClicks: { clickInfo: { total: number; awardedCents: number }; sessionInfo: { moneyCounter: number } }[] }) {
  return data.allClicks.map(click => ({ total: click.clickInfo.total, awardedCents: click.clickInfo.awardedCents, moneyCounter: click.sessionInfo.moneyCounter }));
}

test('researcher launches saved conditions once and participant keeps only earned sequence balance through final stop', async ({ page, request, app }) => {
  await freezeClock(page);
  const a = await createConfiguration(request, app.apiURL, 'Visible A');
  const b = await createConfiguration(request, app.apiURL, 'Visible B', { timeLimit: 90, startingMoney: 1000, moneyLimit: 1300 });
  const sequence = await saveSequence(request, app.apiURL, [a.configId, b.configId]);
  const participantId = `participant-${randomUUID()}`;
  await page.goto('/sequences');
  await page.getByRole('button', { name: `Start ${sequence.name}`, exact: true }).click();
  await page.getByLabel('Participant ID', { exact: true }).fill(participantId);
  const launched = page.waitForResponse(response => response.url() === `${app.apiURL}/sequences/${sequence.sequenceId}/runs` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start Sequence', exact: true }).click();
  const launch = await launched;
  expect(launch.status()).toBe(201);
  const run = await launch.json() as SequenceRun;
  await expect(page).toHaveURL(`/sequence-runs/${run.runId}`);
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  await expect(button).toBeEnabled();
  await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$2.00');
  const apparatus = await page.getByRole('group', { name: 'Participant apparatus', exact: true }).elementHandle();
  const secondStarted = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'start');
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  expect((await secondStarted).status()).toBe(201);
  await expect(button).toBeEnabled();
  expect(await apparatus!.evaluate(node => node.isConnected)).toBe(true);
  await expectNoTransitionScreen(page);
  await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$5.00');
  const first = await readData(request, app.apiURL, run.entries[0].sessionId);
  expect(first.endEvent.value).toMatchObject({ moneyCounter: 500, totalClicks: 1, moneyLimitReached: true, timeLimitReached: false });
  await page.clock.runFor(30_000);
  await expect(button).toBeEnabled();
  expect((await readData(request, app.apiURL, run.entries[1].sessionId)).endEvent).toBeNull();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${run.entries[1].sessionId}/end`);
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  expect(await apparatus!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.getByText(/Money limit reached|Time limit reached|Session ended|Saving session|results/i)).toBeHidden();
  const completed = await readRun(request, app.apiURL, run.runId);
  expect(completed).toMatchObject({ participantId, status: 'completed', currentPosition: 2, sequenceBalance: 800 });
  const second = await readData(request, app.apiURL, run.entries[1].sessionId);
  expect(second.startEvent.value.moneyCounter).toBe(1000);
  expect(second.endEvent.value).toMatchObject({ moneyCounter: 1300, totalClicks: 1, moneyLimitReached: true, timeLimitReached: false });
  const before = await readEvents(request, app.apiURL, run.entries[1].sessionId);
  const writesAfterCompletion: string[] = [];
  page.on('request', write => {
    if (write.method() === 'POST' && write.url().startsWith(app.apiURL)) writesAfterCompletion.push(write.url());
  });
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.press('KeyK');
  await page.clock.runFor(60_000);
  await page.keyboard.press('KeyK');
  expect(await readRun(request, app.apiURL, run.runId)).toEqual(completed);
  expect(await readEvents(request, app.apiURL, run.entries[1].sessionId)).toEqual(before);
  expect(writesAfterCompletion).toEqual([]);
});

test('A B A uses frozen custom and fixed schedules with clean partial counters, hidden balance and continuation', async ({ page, request, app }) => {
  await freezeClock(page);
  const a = await createConfiguration(request, app.apiURL, 'Custom A', {
    timeLimit: 2, moneyLimit: 1000,
    inputs: [{ ...rewardInput, moneyAwarded: 100, rewardSchedule: 'custom', awardInterval: 2, rewardIntervals: [2, 3] }, keyboardInput],
  });
  const b = await createConfiguration(request, app.apiURL, 'Hidden fixed B', {
    timeLimit: 3, startingMoney: 1000, moneyLimit: 1100, continueAfterMoneyLimit: true, showMoneyToParticipant: false,
    inputs: [{ ...rewardInput, moneyAwarded: 100, awardInterval: 2 }, keyboardInput],
  });
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId, a.configId]);
  await openRun(page, app.apiURL, run);
  const apparatus = await page.getByRole('group', { name: 'Participant apparatus', exact: true }).elementHandle();
  for (const configuration of [a, b]) {
    expect((await request.put(`${app.apiURL}/configurations/${configuration.configId}`, {
      data: { name: 'Edited after launch', config: { ...configuration.config, timeLimit: 99, inputs: [] } },
    })).status()).toBe(200);
  }
  expect((await request.put(`${app.apiURL}/sequences/${run.sequenceId}`, { data: { name: 'Reordered after launch', configIds: [b.configId] } })).status()).toBe(200);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  const secondStarted = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'start');
  await page.clock.runFor(2000);
  expect((await secondStarted).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  expect(await apparatus!.evaluate(node => node.isConnected)).toBe(true);
  await expectNoTransitionScreen(page);
  await expect(page.getByLabel('Balance', { exact: true })).toBeHidden();
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  expect((await readData(request, app.apiURL, run.entries[1].sessionId)).endEvent).toBeNull();
  const thirdStarted = eventResponse(page, app.apiURL, run.entries[2].sessionId, 'start');
  await page.clock.runFor(3000);
  expect((await thirdStarted).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  expect(await apparatus!.evaluate(node => node.isConnected)).toBe(true);
  await expectNoTransitionScreen(page);
  await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$4.00');
  await clickAndSave(page, app.apiURL, run.entries[2].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[2].sessionId);
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${run.entries[2].sessionId}/end`);
  await page.clock.runFor(2000);
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
  const first = await readData(request, app.apiURL, run.entries[0].sessionId);
  const second = await readData(request, app.apiURL, run.entries[1].sessionId);
  const third = await readData(request, app.apiURL, run.entries[2].sessionId);
  expect(clickSummary(first)).toEqual([
    { total: 1, awardedCents: 0, moneyCounter: 200 },
    { total: 2, awardedCents: 100, moneyCounter: 300 },
    { total: 3, awardedCents: 0, moneyCounter: 300 },
  ]);
  expect(clickSummary(second)).toEqual([
    { total: 1, awardedCents: 0, moneyCounter: 1000 },
    { total: 2, awardedCents: 100, moneyCounter: 1100 },
    { total: 3, awardedCents: 0, moneyCounter: 1100 },
  ]);
  expect(clickSummary(third)).toEqual([
    { total: 1, awardedCents: 0, moneyCounter: 200 },
    { total: 2, awardedCents: 100, moneyCounter: 300 },
  ]);
  expect(first.endEvent.value).toMatchObject({ totalClicks: 3, moneyLimitReached: false, timeLimitReached: true });
  expect(second.endEvent.value).toMatchObject({ totalClicks: 3, moneyLimitReached: true, timeLimitReached: true });
  expect(third.endEvent.value).toMatchObject({ totalClicks: 2, moneyLimitReached: false, timeLimitReached: true });
  expect([first.sessionConfig, second.sessionConfig, third.sessionConfig]).toEqual([a.config, b.config, a.config]);
  expect(await readRun(request, app.apiURL, run.runId)).toMatchObject({ status: 'completed', currentPosition: 3, sequenceBalance: 500 });
});

test('Home distinguishes planned conditions from active, completed and interrupted research records', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'History condition');
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId, a.configId]);
  await page.goto('/');
  const rows = page.getByRole('row').filter({ hasText: run.participantId });
  await expect(rows).toHaveCount(3);
  await expect(rows.getByText('Planned', { exact: true })).toHaveCount(3);
  await expect(rows.getByText('Active', { exact: true })).toHaveCount(0);
  await expect(rows.getByText('Completed', { exact: true })).toHaveCount(0);
  expect((await request.post(`${app.apiURL}/events`, {
    data: { sessionId: run.entries[0].sessionId, event: 'start', value: { moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false }, timestamp: '2026-10-30T14:00:00.000Z' },
  })).status()).toBe(201);
  await page.reload();
  await expect(rows.getByText('Active', { exact: true })).toHaveCount(1);
  await expect(rows.getByText('Planned', { exact: true })).toHaveCount(2);
  expect((await request.post(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`)).status()).toBe(200);
  await page.reload();
  await expect(rows.getByText('Interrupted', { exact: true })).toHaveCount(1);
  await expect(rows.getByText('Planned', { exact: true })).toHaveCount(2);
  await expect(rows.getByText('Active', { exact: true })).toHaveCount(0);
  await expect(rows.getByText('Completed', { exact: true })).toHaveCount(0);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function attemptBlockedInputs(page: Page) {
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  if (await button.count()) {
    await expect(button).toBeDisabled();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  }
  await page.keyboard.press('KeyK');
}

for (const boundary of ['click', 'end'] as const) {
  test(`next condition waits for delayed ${boundary} acknowledgement without a transition screen or replayed input`, async ({ page, request, app }) => {
    await freezeClock(page);
    const a = await createConfiguration(request, app.apiURL, 'Barrier A');
    const b = await createConfiguration(request, app.apiURL, 'Barrier B', { startingMoney: 1000, moneyLimit: 1300 });
    const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
    const firstId = run.entries[0].sessionId;
    const secondId = run.entries[1].sessionId;
    const held = deferred();
    const release = deferred();
    const url = boundary === 'click' ? `${app.apiURL}/events` : `${app.apiURL}/sessions/${firstId}/end`;
    await page.route(url, async route => {
      const write = route.request();
      const body = write.method() === 'POST' ? write.postDataJSON() : null;
      if (body && (boundary === 'end' || (body.sessionId === firstId && body.event === 'click'))) {
        held.resolve();
        await release.promise;
      }
      await route.continue();
    });
    try {
      await openRun(page, app.apiURL, run);
      const apparatus = await page.getByRole('group', { name: 'Participant apparatus', exact: true }).elementHandle();
      await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
      await held.promise;
      await attemptBlockedInputs(page);
      await page.clock.runFor(60_000);
      await attemptBlockedInputs(page);
      expect(await apparatus!.evaluate(node => node.isConnected)).toBe(true);
      await expectNoTransitionScreen(page);
      const pending = await readRun(request, app.apiURL, run.runId);
      expect(pending).toMatchObject({ status: 'running', currentPosition: 0, endedAt: null });
      expect(pending.entries[0].endedAt).toBeNull();
      expect(pending.entries[1]).toMatchObject({ startedAt: null, endedAt: null });
      const data = await readData(request, app.apiURL, firstId);
      expect(data.endEvent).toBeNull();
      expect(data.allClicks).toHaveLength(boundary === 'click' ? 0 : 1);
      expect(await readEvents(request, app.apiURL, secondId)).toEqual([]);
      const nextStarted = eventResponse(page, app.apiURL, secondId, 'start');
      release.resolve();
      expect((await nextStarted).status()).toBe(201);
      await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
      expect(await apparatus!.evaluate(node => node.isConnected)).toBe(true);
      await expectNoTransitionScreen(page);
      const first = await readData(request, app.apiURL, firstId);
      expect(first.endEvent).toMatchObject({
        timestamp: '2026-01-01T00:00:00.000Z',
        value: { moneyCounter: 500, totalClicks: 1, clicks: { reward: 1, key: 0 }, moneyLimitReached: true, timeLimitReached: false },
      });
      expect((await readEvents(request, app.apiURL, firstId)).map(row => row.event)).toEqual(['start', 'click', 'end']);
      const second = await readData(request, app.apiURL, secondId);
      expect(second.startEvent.timestamp).toBe('2026-01-01T00:01:00.000Z');
      expect(second.allClicks).toEqual([]);
      expect(second.endEvent).toBeNull();
      await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$5.00');
    } finally {
      release.resolve();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

test('time expiry drains its accepted in-flight response before starting the next condition', async ({ page, request, app }) => {
  await freezeClock(page);
  const a = await createConfiguration(request, app.apiURL, 'Timed barrier A', { timeLimit: 2, moneyLimit: 5000 });
  const b = await createConfiguration(request, app.apiURL, 'Timed barrier B', { timeLimit: 30, moneyLimit: 5000 });
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
  const firstId = run.entries[0].sessionId;
  const secondId = run.entries[1].sessionId;
  const held = deferred();
  const release = deferred();
  await page.route(`${app.apiURL}/events`, async route => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (body?.sessionId === firstId && body.event === 'click') {
      held.resolve();
      await release.promise;
    }
    await route.continue();
  });
  try {
    await openRun(page, app.apiURL, run);
    await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
    await held.promise;
    await page.clock.runFor(2000);
    await attemptBlockedInputs(page);
    await expectNoTransitionScreen(page);
    expect((await readData(request, app.apiURL, firstId)).endEvent).toBeNull();
    expect((await readRun(request, app.apiURL, run.runId)).entries[1].startedAt).toBeNull();
    const nextStarted = eventResponse(page, app.apiURL, secondId, 'start');
    release.resolve();
    expect((await nextStarted).status()).toBe(201);
    await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
    const first = await readData(request, app.apiURL, firstId);
    expect(first.endEvent).toMatchObject({
      timestamp: '2026-01-01T00:00:02.000Z',
      value: { moneyCounter: 500, totalClicks: 1, clicks: { reward: 1, key: 0 }, moneyLimitReached: false, timeLimitReached: true },
    });
    expect((await readData(request, app.apiURL, secondId)).allClicks).toEqual([]);
    await page.clock.runFor(2000);
    expect((await readData(request, app.apiURL, secondId)).endEvent).toBeNull();
    await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const failure of [
  { boundary: 'click', position: 0, status: 'interrupted', balance: 200, firstEvents: ['start'], interruptFails: false },
  { boundary: 'end', position: 0, status: 'running', balance: 500, firstEvents: ['start', 'click'], interruptFails: true },
  { boundary: 'start', position: 1, status: 'interrupted', balance: 500, firstEvents: ['start', 'click', 'end'], interruptFails: false },
] as const) {
  test(`${failure.boundary} save failure stops the run${failure.interruptFails ? ' and reports unsaved interruption status' : ' without a false end or retry'}`, async ({ page, request, app }) => {
    await freezeClock(page);
    const a = await createConfiguration(request, app.apiURL, 'Failure condition');
    const run = await launchRun(request, app.apiURL, [a.configId, a.configId, a.configId]);
    const firstId = run.entries[0].sessionId;
    const secondId = run.entries[1].sessionId;
    let failedRequests = 0;
    const url = failure.boundary === 'end' ? `${app.apiURL}/sessions/${firstId}/end` : `${app.apiURL}/events`;
    await page.route(url, async route => {
      const write = route.request();
      const body = write.method() === 'POST' ? write.postDataJSON() : null;
      const fails = body && (failure.boundary === 'end'
        || (failure.boundary === 'click' && body.sessionId === firstId && body.event === 'click')
        || (failure.boundary === 'start' && body.sessionId === secondId && body.event === 'start'));
      if (fails) {
        failedRequests++;
        await route.fulfill({ status: 500, json: { error: `Injected ${failure.boundary} write failure` } });
      } else await route.continue();
    });
    if (failure.interruptFails) {
      await page.route(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`, route =>
        route.fulfill({ status: 500, json: { error: 'Injected interruption write failure' } }));
    }
    await openRun(page, app.apiURL, run);
    const interrupted = page.waitForResponse(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`);
    await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
    expect((await interrupted).status()).toBe(failure.interruptFails ? 500 : 200);
    await expect(page.getByRole('alert')).toContainText(/could not be saved|failed to save|could not save/i);
    if (failure.interruptFails) await expect(page.getByRole('alert')).toContainText(/interrupt/i);
    await expect(page.getByText('Session complete.', { exact: true })).toBeHidden();
    await attemptBlockedInputs(page);
    await page.clock.runFor(60_000);
    await attemptBlockedInputs(page);
    expect(failedRequests).toBe(1);
    const stopped = await readRun(request, app.apiURL, run.runId);
    expect(stopped).toMatchObject({ status: failure.status, currentPosition: failure.position, sequenceBalance: failure.balance });
    expect((await readEvents(request, app.apiURL, firstId)).map(row => row.event)).toEqual(failure.firstEvents);
    expect(await readEvents(request, app.apiURL, secondId)).toEqual([]);
    expect(stopped.entries[1]).toMatchObject({ startedAt: null, endedAt: null });
    expect(stopped.entries[2]).toMatchObject({ startedAt: null, endedAt: null });
    const second = await readData(request, app.apiURL, secondId);
    expect(second.startEvent).toBeNull();
    expect(second.endEvent).toBeNull();
    if (failure.position === 0) expect((await readData(request, app.apiURL, firstId)).endEvent).toBeNull();
  });
}

test('a held keyboard key must release before it can count in the next condition', async ({ page, request, app }) => {
  await freezeClock(page);
  const a = await createConfiguration(request, app.apiURL, 'Held key A', {
    inputs: [rewardInput, { ...keyboardInput, isRewarded: true, moneyAwarded: 300 }],
  });
  const b = await createConfiguration(request, app.apiURL, 'Held key B', {
    startingMoney: 1000, moneyLimit: 5000,
    inputs: [rewardInput, { ...keyboardInput, isRewarded: true, moneyAwarded: 100 }],
  });
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
  await openRun(page, app.apiURL, run);
  const firstSaved = eventResponse(page, app.apiURL, run.entries[0].sessionId, 'click');
  const nextStarted = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'start');
  await page.keyboard.down('KeyK');
  expect((await firstSaved).status()).toBe(201);
  expect((await nextStarted).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await page.clock.runFor(100);
  await page.keyboard.down('KeyK');
  await page.clock.runFor(100);
  expect((await readData(request, app.apiURL, run.entries[1].sessionId)).allClicks).toEqual([]);
  await page.keyboard.up('KeyK');
  await page.clock.runFor(100);
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId, true);
  const second = await readData(request, app.apiURL, run.entries[1].sessionId);
  expect(second.allClicks).toHaveLength(1);
  expect(second.allClicks[0]).toMatchObject({
    inputId: 'key', clickInfo: { total: 1, awardedCents: 100 }, sessionInfo: { moneyCounter: 1100 },
  });
  expect(second.endEvent).toBeNull();
});

test('native Space release after a time boundary does not become a response in the next condition', async ({ page, request, app }) => {
  await freezeClock(page);
  const a = await createConfiguration(request, app.apiURL, 'Held native Space A', { timeLimit: 1, moneyLimit: 5000 });
  const b = await createConfiguration(request, app.apiURL, 'Held native Space B', { timeLimit: 30, moneyLimit: 5000 });
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
  const secondId = run.entries[1].sessionId;
  let secondClickPosts = 0;
  page.on('request', write => {
    if (write.url() !== `${app.apiURL}/events` || write.method() !== 'POST') return;
    const body = write.postDataJSON();
    if (body.sessionId === secondId && body.event === 'click') secondClickPosts++;
  });
  await openRun(page, app.apiURL, run);
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  await button.focus();
  await page.keyboard.down('Space');
  const nextStarted = eventResponse(page, app.apiURL, secondId, 'start');
  await page.clock.runFor(1000);
  expect((await nextStarted).status()).toBe(201);
  await expect(button).toBeEnabled();
  // Model refocusing the enabled apparatus while the physical Space key remains held.
  await button.focus();
  await page.keyboard.up('Space');
  await page.clock.runFor(100);
  expect((await readData(request, app.apiURL, secondId)).allClicks).toEqual([]);
  expect(secondClickPosts).toBe(0);
  const deliberateResponse = eventResponse(page, app.apiURL, secondId, 'click');
  await page.keyboard.press('Space');
  expect((await deliberateResponse).status()).toBe(201);
  const second = await readData(request, app.apiURL, secondId);
  expect(second.allClicks).toHaveLength(1);
  expect(second.allClicks[0]).toMatchObject({
    inputId: 'reward', clickInfo: { total: 1, awardedCents: 300 }, sessionInfo: { moneyCounter: 500 },
  });
  expect(secondClickPosts).toBe(1);
  expect(second.endEvent).toBeNull();
});

test('simulated held gamepad button and newly mapped axis both require release across the boundary', async ({ page, request, app }) => {
  await freezeClock(page);
  // Browser Gamepad API simulation proves release gating, not physical device compatibility.
  await page.addInitScript(() => {
    const state = { button: false, axis: 0 };
    Object.defineProperty(window, '__sequenceGamepad', { value: state });
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [{
        id: 'Sequence test controller', index: 0, connected: true, mapping: 'standard', timestamp: 0,
        buttons: [{ pressed: state.button, touched: state.button, value: state.button ? 1 : 0 }],
        axes: [state.axis], vibrationActuator: null,
      }],
    });
  });
  const pad: InputConfig = {
    id: 'pad', name: 'Gamepad button', type: 'gamepad_button', inputCode: 'gp-0-btn-0',
    isRewarded: true, moneyAwarded: 300, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
  };
  const a = await createConfiguration(request, app.apiURL, 'Held pad A', { inputs: [rewardInput, pad] });
  const b = await createConfiguration(request, app.apiURL, 'Held pad B', {
    startingMoney: 1000, moneyLimit: 5000,
    inputs: [
      rewardInput, { ...pad, id: 'new-pad', moneyAwarded: 100 },
      { ...pad, id: 'axis', name: 'Gamepad axis', type: 'gamepad_axis', inputCode: 'gp-0-axis-0-pos', moneyAwarded: 100 },
    ],
  });
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
  const held = deferred();
  const release = deferred();
  await page.route(`${app.apiURL}/sessions/${run.entries[0].sessionId}/end`, async route => {
    held.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await openRun(page, app.apiURL, run);
    await setGamepad(page, true, 1);
    await page.clock.runFor(100);
    await held.promise;
    await page.clock.runFor(100);
    const nextStarted = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'start');
    release.resolve();
    expect((await nextStarted).status()).toBe(201);
    await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
    await page.clock.runFor(100);
    expect((await readData(request, app.apiURL, run.entries[1].sessionId)).allClicks).toEqual([]);
    await setGamepad(page, false, 0);
    await page.clock.runFor(100);
    const buttonSaved = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'click');
    await setGamepad(page, true, 0);
    await page.clock.runFor(100);
    expect((await buttonSaved).status()).toBe(201);
    const axisSaved = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'click');
    await setGamepad(page, true, 1);
    await page.clock.runFor(100);
    expect((await axisSaved).status()).toBe(201);
    const second = await readData(request, app.apiURL, run.entries[1].sessionId);
    expect(second.allClicks).toHaveLength(2);
    expect(second.allClicks[0]).toMatchObject({ inputId: 'new-pad', clickInfo: { total: 1, awardedCents: 100 } });
    expect(second.allClicks[1]).toMatchObject({ inputId: 'axis', clickInfo: { total: 2, awardedCents: 100 } });
    await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$7.00');
    const ended = page.waitForResponse(`${app.apiURL}/sessions/${run.entries[1].sessionId}/end`);
    await page.clock.runFor(30_000);
    expect((await ended).status()).toBe(200);
    await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeDisabled();
    const before = await readEvents(request, app.apiURL, run.entries[1].sessionId);
    await setGamepad(page, false, 0);
    await page.clock.runFor(100);
    await setGamepad(page, true, 1);
    await page.clock.runFor(100);
    expect(await readEvents(request, app.apiURL, run.entries[1].sessionId)).toEqual(before);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

async function setGamepad(page: Page, button: boolean, axis: number) {
  await page.evaluate(state => {
    if (!('__sequenceGamepad' in window)) throw new Error('Simulated gamepad fixture missing');
    const gamepad = window.__sequenceGamepad;
    if (!gamepad || typeof gamepad !== 'object') throw new Error('Invalid simulated gamepad fixture');
    Object.assign(gamepad, state);
  }, { button, axis });
}

test('condition change clears COD bank and activation history plus pause threshold and partial interval state', async ({ page, request, app }) => {
  await freezeClock(page);
  const pauseAndCOD: Partial<BaseConfig> = {
    moneyLimit: 5000, changeoverDelayEnabled: true, changeoverDelayMs: 1000,
    pauseEnabled: true, pauseTrigger: 'any', pauseAfterResponses: 3, pauseDurationSeconds: 1, pauseResumeMode: 'auto',
  };
  const a = await createConfiguration(request, app.apiURL, 'Reset A', {
    ...pauseAndCOD, timeLimit: 1, inputs: [{ ...rewardInput, moneyAwarded: 100 }, keyboardInput],
  });
  const b = await createConfiguration(request, app.apiURL, 'Reset B', {
    ...pauseAndCOD, timeLimit: 2, inputs: [{ ...rewardInput, moneyAwarded: 100, awardInterval: 2 }, keyboardInput],
  });
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
  await openRun(page, app.apiURL, run);
  await page.clock.runFor(999);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId, true);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  const nextStarted = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'start');
  await page.clock.runFor(1);
  expect((await nextStarted).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  const first = await readData(request, app.apiURL, run.entries[0].sessionId);
  expect(first.endEvent.value).toMatchObject({ totalClicks: 2, pendingRewards: { reward: 1, key: 0 }, moneyCounter: 200 });
  expect(first.pauseEvents).toEqual([]);
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeHidden();
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeHidden();
  const paused = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'pause');
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  expect((await paused).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  const resumed = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'resume');
  await page.clock.runFor(1000);
  expect((await resumed).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await page.clock.runFor(1999);
  expect((await readData(request, app.apiURL, run.entries[1].sessionId)).endEvent).toBeNull();
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${run.entries[1].sessionId}/end`);
  await page.clock.runFor(1);
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
  const second = await readData(request, app.apiURL, run.entries[1].sessionId);
  expect(clickSummary(second)).toEqual([
    { total: 1, awardedCents: 0, moneyCounter: 200 },
    { total: 2, awardedCents: 100, moneyCounter: 300 },
    { total: 3, awardedCents: 0, moneyCounter: 300 },
  ]);
  expect(second.allClicks.map((click: { codWithheld: boolean; codPending: number }) => [click.codWithheld, click.codPending])).toEqual([[false, 0], [false, 0], [false, 0]]);
  expect(second.pauseEvents).toEqual([
    { event: 'pause', timestamp: '2026-01-01T00:00:01.000Z' },
    { event: 'resume', timestamp: '2026-01-01T00:00:02.000Z' },
  ]);
  expect(second.endEvent).toMatchObject({
    timestamp: '2026-01-01T00:00:04.000Z',
    value: { totalClicks: 3, clicks: { reward: 3, key: 0 }, pendingRewards: { reward: 0, key: 0 }, timeLimitReached: true, moneyLimitReached: false },
  });
});

test('repeated generated variable schedule restarts instead of consuming the previous condition remainder', async ({ page, request, app }) => {
  await freezeClock(page);
  await page.addInitScript(() => { Math.random = () => 0; });
  const a = await createConfiguration(request, app.apiURL, 'Generated reset', {
    timeLimit: 2, moneyLimit: 5000,
    inputs: [{ ...rewardInput, moneyAwarded: 100, rewardSchedule: 'variable', awardInterval: 2 }, keyboardInput],
  });
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
  await openRun(page, app.apiURL, run);
  // Fixed randomness gives generated intervals [3, 1]; leave 1 pending at the boundary.
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  const nextStarted = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'start');
  await page.clock.runFor(2000);
  expect((await nextStarted).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  const first = await readData(request, app.apiURL, run.entries[0].sessionId);
  const second = await readData(request, app.apiURL, run.entries[1].sessionId);
  expect(clickSummary(first)).toEqual([
    { total: 1, awardedCents: 0, moneyCounter: 200 },
    { total: 2, awardedCents: 0, moneyCounter: 200 },
    { total: 3, awardedCents: 100, moneyCounter: 300 },
  ]);
  expect(clickSummary(second)).toEqual([
    { total: 1, awardedCents: 0, moneyCounter: 200 },
    { total: 2, awardedCents: 0, moneyCounter: 200 },
    { total: 3, awardedCents: 100, moneyCounter: 300 },
  ]);
});

test('a planned sequence member cannot participate through the standalone session route', async ({ page, request, app }) => {
  await freezeClock(page);
  const a = await createConfiguration(request, app.apiURL, 'Sequence-owned apparatus', { moneyLimit: 5000 });
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
  const firstId = run.entries[0].sessionId;
  const writes: string[] = [];
  page.on('request', write => {
    if (write.method() === 'POST' && write.url().startsWith(app.apiURL)) writes.push(write.url());
  });
  await page.goto(`/session/${firstId}`);
  await expect(page.getByRole('alert')).toContainText(/sequence.*run|run.*sequence/i);
  await attemptBlockedInputs(page);
  await page.clock.runFor(1000);
  expect(writes).toEqual([]);
  expect(await readEvents(request, app.apiURL, firstId)).toEqual([]);
  const blocked = await readRun(request, app.apiURL, run.runId);
  expect(blocked).toMatchObject({ status: 'running', currentPosition: 0, sequenceBalance: 200 });
  expect(blocked.entries[0]).toMatchObject({ startedAt: null, endedAt: null });
  expect(blocked.entries[1]).toMatchObject({ startedAt: null, endedAt: null });
  await openRun(page, app.apiURL, run);
  await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$2.00');
  await clickAndSave(page, app.apiURL, firstId);
  const proper = await readData(request, app.apiURL, firstId);
  expect(proper.startEvent).toMatchObject({ value: { moneyCounter: 200, moneyLimitReached: false, timeLimitReached: false } });
  expect(proper.allClicks).toHaveLength(1);
  expect(proper.allClicks[0]).toMatchObject({
    inputId: 'reward', clickInfo: { total: 1, awardedCents: 300 }, sessionInfo: { moneyCounter: 500 },
  });
  expect(proper.endEvent).toBeNull();
  expect((await readRun(request, app.apiURL, run.runId)).entries[1].startedAt).toBeNull();
});

test('closing and reopening recognizes abandonment even when unload interruption never reaches the API', async ({ page, context, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Reload partial condition', { moneyLimit: 5000 });
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
  await openRun(page, app.apiURL, run);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  const saved = await readData(request, app.apiURL, run.entries[0].sessionId);
  await page.route(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`, route => route.abort());
  await page.close();
  expect((await readRun(request, app.apiURL, run.runId)).status).toBe('running');
  const reopenedPage = await context.newPage();
  await reopenedPage.goto(`/sequence-runs/${run.runId}`);
  await expect(reopenedPage.getByRole('alert')).toContainText(/interrupted/i);
  const interrupted = await readRun(request, app.apiURL, run.runId);
  expect(interrupted).toMatchObject({ status: 'interrupted', currentPosition: 0, sequenceBalance: 500 });
  expect(interrupted.entries[0].endedAt).toBeNull();
  expect(interrupted.entries[1]).toMatchObject({ startedAt: null, endedAt: null });
  expect(await readData(request, app.apiURL, run.entries[0].sessionId)).toEqual({ ...saved, sequenceStatus: 'interrupted' });
  expect((await readEvents(request, app.apiURL, run.entries[0].sessionId)).map(row => row.event)).toEqual(['start', 'click']);
  expect(await readEvents(request, app.apiURL, run.entries[1].sessionId)).toEqual([]);
  await reopenedPage.reload();
  await expect(reopenedPage.getByRole('alert')).toContainText(/interrupted/i);
  expect(await readRun(request, app.apiURL, run.runId)).toEqual(interrupted);
});

test('reload preserves completed and paused partial records and requires a deliberately launched fresh run', async ({ page, request, app }) => {
  await freezeClock(page);
  const a = await createConfiguration(request, app.apiURL, 'Completed before reload');
  const b = await createConfiguration(request, app.apiURL, 'Paused before reload', {
    moneyLimit: 5000, pauseEnabled: true, pauseTrigger: 'any',
    pauseAfterResponses: 1, pauseDurationSeconds: 1, pauseResumeMode: 'auto',
  });
  const run = await launchRun(request, app.apiURL, [a.configId, b.configId]);
  await openRun(page, app.apiURL, run);
  const nextStarted = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'start');
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  expect((await nextStarted).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  const paused = eventResponse(page, app.apiURL, run.entries[1].sessionId, 'pause');
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  expect((await paused).status()).toBe(201);
  const completed = await readData(request, app.apiURL, run.entries[0].sessionId);
  const partial = await readData(request, app.apiURL, run.entries[1].sessionId);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(/interrupted/i);
  await page.clock.runFor(60_000);
  await attemptBlockedInputs(page);
  const stopped = await readRun(request, app.apiURL, run.runId);
  expect(stopped).toMatchObject({ status: 'interrupted', currentPosition: 1, sequenceBalance: 800 });
  expect(await readData(request, app.apiURL, run.entries[0].sessionId)).toEqual(completed);
  expect(await readData(request, app.apiURL, run.entries[1].sessionId)).toEqual({ ...partial, sequenceStatus: 'interrupted' });
  expect(partial.endEvent).toBeNull();
  expect((await readEvents(request, app.apiURL, run.entries[1].sessionId)).map(row => row.event)).toEqual(['start', 'click', 'pause']);

  await page.getByRole('link', { name: 'Session Sequences', exact: true }).click();
  await page.getByRole('button', { name: `Start ${run.sequenceName}`, exact: true }).click();
  await page.getByLabel('Participant ID', { exact: true }).fill(run.participantId);
  const launched = page.waitForResponse(response => response.url() === `${app.apiURL}/sequences/${run.sequenceId}/runs` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start Sequence', exact: true }).click();
  const fresh = await (await launched).json() as SequenceRun;
  expect(fresh.runId).not.toBe(run.runId);
  expect(fresh.entries.map(entry => entry.sessionId)).not.toEqual(run.entries.map(entry => entry.sessionId));
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$2.00');
  await clickAndSave(page, app.apiURL, fresh.entries[0].sessionId, true);
  expect((await readData(request, app.apiURL, fresh.entries[0].sessionId)).allClicks[0]).toMatchObject({ inputId: 'key', clickInfo: { total: 1, awardedCents: 0 } });
  expect(await readRun(request, app.apiURL, run.runId)).toEqual(stopped);
  expect(await readData(request, app.apiURL, run.entries[1].sessionId)).toEqual({ ...partial, sequenceStatus: 'interrupted' });
});

for (const boundary of ['click acknowledgement', 'end request', 'end acknowledgement'] as const) {
  test(`navigation during delayed ${boundary} cannot resurrect an abandoned run or stop a fresh one`, async ({ page, request, app }) => {
    await freezeClock(page);
    const a = await createConfiguration(request, app.apiURL, 'Abandoned save');
    const b = await createConfiguration(request, app.apiURL, 'Fresh long condition', { timeLimit: 300, moneyLimit: 5000 });
    const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
    const firstId = run.entries[0].sessionId;
    const held = deferred();
    const release = deferred();
    const url = boundary === 'click acknowledgement' ? `${app.apiURL}/events` : `${app.apiURL}/sessions/${firstId}/end`;
    await page.route(url, async route => {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      if (!body || (boundary === 'click acknowledgement' && (body.sessionId !== firstId || body.event !== 'click'))) {
        await route.continue();
        return;
      }
      const response = boundary === 'end request' ? null : await route.fetch();
      held.resolve();
      await release.promise;
      if (response) await route.fulfill({ response });
      else await route.continue();
    });
    try {
      await openRun(page, app.apiURL, run);
      await page.getByRole('button', { name: 'Click Me', exact: true }).click({ force: true });
      await held.promise;
      const interrupted = page.waitForResponse(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      expect((await interrupted).status()).toBe(200);
      const stopped = await readRun(request, app.apiURL, run.runId);
      expect(stopped).toMatchObject({
        status: 'interrupted', currentPosition: boundary === 'end acknowledgement' ? 1 : 0, sequenceBalance: 500,
      });
      const before = await readEvents(request, app.apiURL, firstId);
      const fresh = await launchRun(request, app.apiURL, [b.configId, b.configId]);
      // SPA navigation keeps the old pending callback alive in the same document.
      await page.evaluate(runId => {
        window.history.pushState({}, '', `/sequence-runs/${runId}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, fresh.runId);
      await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
      const acknowledged = boundary === 'click acknowledgement'
        ? eventResponse(page, app.apiURL, firstId, 'click')
        : page.waitForResponse(`${app.apiURL}/sessions/${firstId}/end`);
      release.resolve();
      await (await acknowledged).finished();
      await page.clock.runFor(60_000);
      await clickAndSave(page, app.apiURL, fresh.entries[0].sessionId);
      expect(await readRun(request, app.apiURL, run.runId)).toEqual(stopped);
      expect(await readEvents(request, app.apiURL, firstId)).toEqual(before);
      expect(await readEvents(request, app.apiURL, run.entries[1].sessionId)).toEqual([]);
      expect((await readData(request, app.apiURL, fresh.entries[0].sessionId)).allClicks[0]).toMatchObject({
        clickInfo: { total: 1, awardedCents: 300 }, sessionInfo: { moneyCounter: 500 },
      });
      expect((await readRun(request, app.apiURL, fresh.runId)).status).toBe('running');
      await expect(page.getByRole('alert')).toBeHidden();
    } finally {
      release.resolve();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

test('completed run survives navigation before final acknowledgement, late interruption and repeated reopening', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Completed before acknowledgement');
  const run = await launchRun(request, app.apiURL, [a.configId]);
  const held = deferred();
  const release = deferred();
  await page.route(`${app.apiURL}/sessions/${run.entries[0].sessionId}/end`, async route => {
    const response = await route.fetch();
    held.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await openRun(page, app.apiURL, run);
    await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
    await held.promise;
    const completed = await readRun(request, app.apiURL, run.runId);
    expect(completed.status).toBe('completed');
    const saved = await readData(request, app.apiURL, run.entries[0].sessionId);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    const acknowledged = page.waitForResponse(`${app.apiURL}/sessions/${run.entries[0].sessionId}/end`);
    release.resolve();
    await (await acknowledged).finished();
    expect((await request.post(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`)).status()).toBe(200);
    for (let visit = 0; visit < 2; visit++) {
      await page.goto(`/sequence-runs/${run.runId}`);
      await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
      await attemptBlockedInputs(page);
      expect(await readRun(request, app.apiURL, run.runId)).toEqual(completed);
      expect(await readData(request, app.apiURL, run.entries[0].sessionId)).toEqual(saved);
    }
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('failed abandonment save is disclosed on re-entry and never permits participation', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Unreachable interruption', { moneyLimit: 5000 });
  const run = await launchRun(request, app.apiURL, [a.configId, a.configId]);
  await openRun(page, app.apiURL, run);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  const before = await readEvents(request, app.apiURL, run.entries[0].sessionId);
  await page.route(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`, route =>
    route.fulfill({ status: 503, json: { error: 'Interruption storage unavailable' } }));
  await page.goto('about:blank');
  await page.goto(`/sequence-runs/${run.runId}`);
  await expect(page.getByRole('alert')).toContainText(/could not.*interrupt|interruption.*could not|unable.*interrupt/i);
  await expect(page.getByRole('alert')).toContainText('Interruption storage unavailable');
  await attemptBlockedInputs(page);
  expect((await readRun(request, app.apiURL, run.runId)).status).toBe('running');
  expect(await readEvents(request, app.apiURL, run.entries[0].sessionId)).toEqual(before);
  expect(await readEvents(request, app.apiURL, run.entries[1].sessionId)).toEqual([]);
  await page.unrouteAll({ behavior: 'wait' });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(/interrupted/i);
  expect((await readRun(request, app.apiURL, run.runId)).status).toBe('interrupted');
  expect(await readEvents(request, app.apiURL, run.entries[0].sessionId)).toEqual(before);
});
