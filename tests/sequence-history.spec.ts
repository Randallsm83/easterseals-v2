import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import type { BaseConfig, InputConfig, SequenceRun, SessionDataResponse } from '../client/src/types';

const leftInput: InputConfig = {
  id: 'left', name: 'Left', type: 'screen', shape: 'rectangle', color: '#2563eb',
  isRewarded: true, moneyAwarded: 125, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
};
const rightInput: InputConfig = {
  id: 'right', name: 'Right', type: 'screen', shape: 'circle', color: '#e39400',
  isRewarded: false, moneyAwarded: 0, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
};

type RecordedEvent = [event: 'start' | 'click' | 'pause' | 'resume' | 'end', timestamp: string, value: Record<string, unknown>];

async function createConfiguration(request: APIRequestContext, apiURL: string, name: string, overrides: Partial<BaseConfig> = {}) {
  const configId = `history-${randomUUID()}`;
  const config: BaseConfig = {
    timeLimit: 30, moneyLimit: 10000, startingMoney: 1250, continueAfterMoneyLimit: false,
    pauseEnabled: true, pauseTrigger: 'any', pauseAfterResponses: 2, pauseDurationSeconds: 10,
    pauseResumeMode: 'manual', pauseResumeBinding: { type: 'any' },
    inputs: [leftInput, rightInput], ...overrides,
  };
  const response = await request.post(`${apiURL}/configurations`, { data: { configId, name, config } });
  expect(response.status()).toBe(201);
  return { configId, name, config };
}

async function launchRun(request: APIRequestContext, apiURL: string, name: string, configIds: string[]) {
  const created = await request.post(`${apiURL}/sequences`, { data: { name, configIds } });
  expect(created.status()).toBe(201);
  const { sequenceId } = await created.json();
  const launched = await request.post(`${apiURL}/sequences/${sequenceId}/runs`, {
    data: { participantId: `history-participant-${randomUUID()}` },
  });
  expect(launched.status()).toBe(201);
  return launched.json() as Promise<SequenceRun>;
}

async function recordEvents(request: APIRequestContext, apiURL: string, sessionId: string, events: RecordedEvent[]) {
  for (const [event, timestamp, value] of events) {
    const response = event === 'end'
      ? await request.post(`${apiURL}/sessions/${sessionId}/end`, { data: { value, timestamp } })
      : await request.post(`${apiURL}/events`, { data: { sessionId, event, timestamp, value } });
    expect(response.status(), `${sessionId}: ${event} at ${timestamp}`).toBe(event === 'end' ? 200 : 201);
  }
}

async function readRun(request: APIRequestContext, apiURL: string, runId: string): Promise<SequenceRun> {
  const response = await request.get(`${apiURL}/sequence-runs/${runId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function readData(request: APIRequestContext, apiURL: string, sessionId: string): Promise<SessionDataResponse> {
  const response = await request.get(`${apiURL}/sessions/${sessionId}/data`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function expectAnalyticsMetric(page: Page, label: string, value: string) {
  const caption = page.getByText(label, { exact: true }).and(page.locator('div'));
  await expect(caption.locator('xpath=preceding-sibling::div[1]')).toHaveText(value);
}

async function expectComparisonMetric(page: Page, label: string, values: string[]) {
  const caption = page.getByText(label, { exact: true }).and(page.locator('div'));
  await expect(caption.locator('..').locator(':scope > div')).toHaveText([label, ...values]);
}

function compareSelected(page: Page) {
  return page.getByRole('link', { name: 'Compare selected sessions', exact: true })
    .or(page.getByRole('button', { name: 'Compare selected sessions', exact: true }));
}

test('completed A B A history retains frozen conditions and distinct analytics through source edits and deletion', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'History A');
  const b = await createConfiguration(request, app.apiURL, 'History B', {
    timeLimit: 45, moneyLimit: 20000, startingMoney: 3000,
    inputs: [{ ...leftInput, isRewarded: false, moneyAwarded: 0 }, { ...rightInput, isRewarded: true, moneyAwarded: 250 }],
  });
  const run = await launchRun(request, app.apiURL, 'Frozen history A B A', [a.configId, b.configId, a.configId]);
  const [first, second, third] = run.entries;
  expect(new Set(run.entries.map(entry => entry.sessionId)).size).toBe(3);

  for (const configuration of [a, b]) {
    const edited = await request.put(`${app.apiURL}/configurations/${configuration.configId}`, {
      data: {
        name: `Edited ${configuration.name}`,
        config: { ...configuration.config, startingMoney: 0, timeLimit: 999, inputs: configuration.config.inputs.map(input => ({ ...input, isRewarded: !input.isRewarded })) },
      },
    });
    expect(edited.status()).toBe(200);
  }
  expect((await request.put(`${app.apiURL}/sequences/${run.sequenceId}`, {
    data: { name: 'Edited setup B A B', configIds: [b.configId, a.configId, b.configId] },
  })).status()).toBe(200);
  expect((await request.delete(`${app.apiURL}/sequences/${run.sequenceId}`)).status()).toBe(200);

  await recordEvents(request, app.apiURL, first.sessionId, [
    ['start', '2026-10-30T10:00:00.000Z', { moneyCounter: 1250, moneyLimitReached: false, timeLimitReached: false }],
    ['click', '2026-10-30T10:00:05.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 1, clicks: { left: 1, right: 0 }, moneyCounter: 1375, awardedCents: 125 }],
    ['click', '2026-10-30T10:00:10.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 2, clicks: { left: 2, right: 0 }, moneyCounter: 1500, awardedCents: 125 }],
    ['pause', '2026-10-30T10:00:10.000Z', {}],
    ['resume', '2026-10-30T10:00:20.000Z', {}],
    ['click', '2026-10-30T10:00:25.000Z', { inputId: 'right', inputName: 'Right', totalClicks: 3, clicks: { left: 2, right: 1 }, moneyCounter: 1500, awardedCents: 0 }],
    ['end', '2026-10-30T10:00:30.000Z', { moneyCounter: 1500, moneyLimitReached: false, timeLimitReached: false, totalClicks: 3, clicks: { left: 2, right: 1 }, pendingRewards: { left: 0, right: 0 } }],
  ]);
  await recordEvents(request, app.apiURL, second.sessionId, [
    ['start', '2026-10-30T10:01:00.000Z', { moneyCounter: 3000, moneyLimitReached: false, timeLimitReached: false }],
    ['click', '2026-10-30T10:01:05.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 1, clicks: { left: 1, right: 0 }, moneyCounter: 3000, awardedCents: 0 }],
    ['click', '2026-10-30T10:01:15.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 2, clicks: { left: 2, right: 0 }, moneyCounter: 3000, awardedCents: 0 }],
    ['pause', '2026-10-30T10:01:15.000Z', {}],
    ['resume', '2026-10-30T10:01:30.000Z', {}],
    ['click', '2026-10-30T10:01:40.000Z', { inputId: 'right', inputName: 'Right', totalClicks: 3, clicks: { left: 2, right: 1 }, moneyCounter: 3250, awardedCents: 250 }],
    ['end', '2026-10-30T10:01:45.000Z', { moneyCounter: 3250, moneyLimitReached: false, timeLimitReached: false, totalClicks: 3, clicks: { left: 2, right: 1 }, pendingRewards: { left: 0, right: 0 } }],
  ]);
  await recordEvents(request, app.apiURL, third.sessionId, [
    ['start', '2026-10-30T10:02:00.000Z', { moneyCounter: 1250, moneyLimitReached: false, timeLimitReached: false }],
    ['click', '2026-10-30T10:02:05.000Z', { inputId: 'right', inputName: 'Right', totalClicks: 1, clicks: { left: 0, right: 1 }, moneyCounter: 1250, awardedCents: 0 }],
    ['click', '2026-10-30T10:02:10.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 2, clicks: { left: 1, right: 1 }, moneyCounter: 1375, awardedCents: 125 }],
    ['pause', '2026-10-30T10:02:10.000Z', {}],
    ['resume', '2026-10-30T10:02:20.000Z', {}],
    ['click', '2026-10-30T10:02:25.000Z', { inputId: 'right', inputName: 'Right', totalClicks: 3, clicks: { left: 1, right: 2 }, moneyCounter: 1375, awardedCents: 0 }],
    ['click', '2026-10-30T10:02:35.000Z', { inputId: 'right', inputName: 'Right', totalClicks: 4, clicks: { left: 1, right: 3 }, moneyCounter: 1375, awardedCents: 0 }],
    ['end', '2026-10-30T10:02:40.000Z', { moneyCounter: 1375, moneyLimitReached: false, timeLimitReached: true, totalClicks: 4, clicks: { left: 1, right: 3 }, pendingRewards: { left: 0, right: 0 } }],
  ]);

  const completed = await readRun(request, app.apiURL, run.runId);
  expect(completed).toMatchObject({ sequenceId: run.sequenceId, sequenceName: 'Frozen history A B A', participantId: run.participantId, status: 'completed', currentPosition: 3 });
  expect(completed.entries.map(entry => ({ position: entry.position, sessionId: entry.sessionId, configName: entry.configName, config: entry.config }))).toEqual([
    { position: 0, sessionId: first.sessionId, configName: 'History A', config: a.config },
    { position: 1, sessionId: second.sessionId, configName: 'History B', config: b.config },
    { position: 2, sessionId: third.sessionId, configName: 'History A', config: a.config },
  ]);
  for (const configuration of [a, b]) {
    expect((await request.delete(`${app.apiURL}/configurations/${configuration.configId}`)).status()).toBe(409);
  }
  const listed = await request.get(`${app.apiURL}/sequence-runs`);
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ runId: run.runId, sequenceId: run.sequenceId, sequenceName: 'Frozen history A B A', participantId: run.participantId, status: 'completed' }),
  ]));

  await page.goto('/');
  await page.getByRole('link', { name: 'Sequence Runs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sequence Runs', exact: true })).toBeVisible();
  const historyRow = page.getByRole('table', { name: 'Sequence runs', exact: true }).getByRole('row').filter({ hasText: run.runId });
  await expect(historyRow).toHaveCount(1);
  await expect(historyRow.getByText('Frozen history A B A', { exact: true })).toBeVisible();
  await expect(historyRow.getByText(run.participantId, { exact: true })).toBeVisible();
  await expect(historyRow.getByText('Completed', { exact: true })).toBeVisible();
  const historyLink = historyRow.getByRole('link', { name: run.runId, exact: true });
  await expect(historyLink).toHaveAttribute('href', `/sequence-history/${run.runId}`);
  await historyLink.click();
  await expect(page.getByRole('heading', { name: 'Frozen history A B A', exact: true })).toBeVisible();
  await expect(page.getByText(run.participantId, { exact: true })).toBeVisible();
  await expect(page.getByText(run.runId, { exact: true })).toBeVisible();
  await expect(page.getByText(run.sequenceId, { exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Run sessions', exact: true });
  const rows = table.locator('tbody').getByRole('row');
  await expect(rows).toHaveCount(3);
  for (const [index, entry] of run.entries.entries()) {
    const row = rows.nth(index);
    await expect(row.getByRole('rowheader')).toHaveText(String(index + 1));
    await expect(row.getByText(index === 1 ? 'History B' : 'History A', { exact: true })).toBeVisible();
    await expect(row.getByRole('cell').filter({ hasText: entry.sessionId }).first()).toBeVisible();
    await expect(row.getByText('Completed', { exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: `Analytics for ${entry.sessionId}`, exact: true })).toHaveAttribute('href', `/analytics/${entry.sessionId}`);
  }

  for (const expected of [
    { sessionId: first.sessionId, total: '3', correct: '2', accuracy: '66.7%', money: '$15.00', duration: '30s', active: '20s', paused: '10s' },
    { sessionId: third.sessionId, total: '4', correct: '1', accuracy: '25%', money: '$13.75', duration: '40s', active: '30s', paused: '10s' },
  ]) {
    await table.getByRole('link', { name: `Analytics for ${expected.sessionId}`, exact: true }).click();
    await expect(page).toHaveURL(`/analytics/${expected.sessionId}`);
    await expect(page.getByRole('heading', { name: 'Analytics Dashboard', exact: true })).toBeVisible();
    await expectAnalyticsMetric(page, 'Total Clicks', expected.total);
    await expectAnalyticsMetric(page, 'Accuracy', expected.accuracy);
    await expectAnalyticsMetric(page, 'Money Earned', expected.money);
    await expectAnalyticsMetric(page, 'Rewarded Input', 'Left');
    await expectAnalyticsMetric(page, 'Time Limit', '30s');
    await expectAnalyticsMetric(page, 'Starting Money', '$12.50');
    await expectAnalyticsMetric(page, 'Duration', expected.duration);
    await expectAnalyticsMetric(page, 'Active Time', expected.active);
    await expectAnalyticsMetric(page, 'Paused', expected.paused);
    const distribution = page.getByText('Click Distribution', { exact: true }).locator('../..');
    await expect(distribution.getByText('Left', { exact: true }).locator('..').getByText(expected.correct, { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Frozen history A B A', exact: true })).toBeVisible();
  }

  const firstCheckbox = table.getByRole('checkbox', { name: `Compare ${first.sessionId}`, exact: true });
  await firstCheckbox.focus();
  await page.keyboard.press('Space');
  await expect(firstCheckbox).toBeChecked();
  await expect(compareSelected(page)).toBeDisabled();
  await table.getByRole('checkbox', { name: `Compare ${second.sessionId}`, exact: true }).check();
  await expect(compareSelected(page)).toBeEnabled();
  await table.getByRole('checkbox', { name: `Compare ${third.sessionId}`, exact: true }).check();
  await compareSelected(page).click();
  await expect(page.getByRole('heading', { name: 'Session Comparison', exact: true })).toBeVisible();
  const query = new URL(page.url()).searchParams;
  expect(query.get('participantId')).toBe(run.participantId);
  expect(query.getAll('sessionId')).toEqual([first.sessionId, second.sessionId, third.sessionId]);
  await expect(page.getByText('3 / 5 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare 3 Sessions', exact: true }).click();
  await expectComparisonMetric(page, 'Total Clicks', ['3', '3', '4']);
  await expectComparisonMetric(page, 'Correct Clicks', ['2', '1', '1']);
  await expectComparisonMetric(page, 'Accuracy', ['67%', '33%', '25%']);
  await expectComparisonMetric(page, 'Money Earned', ['$15.00', '$32.50', '$13.75']);
  await expectComparisonMetric(page, 'Duration', ['30s', '45s', '40s']);
  await expectComparisonMetric(page, 'Active Time', ['20s', '30s', '30s']);
  await expectComparisonMetric(page, 'Paused', ['10s', '15s', '10s']);
  await expectComparisonMetric(page, 'Responses / min (active)', ['9.00', '6.00', '8.00']);
  await expectComparisonMetric(page, 'Responses / min (wall)', ['6.00', '4.00', '6.00']);
  await page.getByRole('button', { name: 'Wall Clock', exact: true }).click();
  await expect(page.getByText(/Cumulative earnings \(5-second buckets, wall clock\)/)).toBeVisible();
  await expectComparisonMetric(page, 'Active Time', ['20s', '30s', '30s']);
  await expectComparisonMetric(page, 'Duration', ['30s', '45s', '40s']);
  await expectComparisonMetric(page, 'Responses / min (active)', ['9.00', '6.00', '8.00']);
  await expectComparisonMetric(page, 'Responses / min (wall)', ['6.00', '4.00', '6.00']);
  await page.getByRole('button', { name: 'Active Time', exact: true }).click();
  await expect(page.getByText(/Cumulative earnings \(5-second buckets, active time\)/)).toBeVisible();

  let markResponseHeld!: () => void;
  let releaseResponse!: () => void;
  const responseHeld = new Promise<void>(resolve => { markResponseHeld = resolve; });
  const responseReleased = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route(`**/sessions/${first.sessionId}/data`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    markResponseHeld();
    await responseReleased;
    await route.fulfill({ response });
  }, { times: 1 });
  const comparisonResponses = Promise.all(run.entries.map(entry =>
    page.waitForResponse(response => response.url().endsWith(`/sessions/${entry.sessionId}/data`))
      .then(response => response.finished())));
  await page.getByRole('button', { name: 'Compare 3 Sessions', exact: true }).click();
  await responseHeld;
  await expect(page.getByRole('button', { name: 'Loading...', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('0 / 5 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare 0 Sessions', exact: true })).toBeDisabled();
  await expect(page.getByText('Stats Comparison', { exact: true })).toHaveCount(0);
  releaseResponse();
  await comparisonResponses;
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(page.getByText('Stats Comparison', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0 / 5 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  for (const entry of [first, third]) {
    await page.getByRole('checkbox', { name: `Compare ${entry.sessionId}`, exact: true }).check();
  }
  await page.getByRole('button', { name: 'Compare 2 Sessions', exact: true }).click();
  await expect(page.getByText('Stats Comparison', { exact: true })).toBeVisible();
  await expectComparisonMetric(page, 'Total Clicks', ['3', '4']);
});

test('interrupted history keeps completed, partial and planned records without fabricating an end or converting standalone sessions', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Interrupted history A');
  const b = await createConfiguration(request, app.apiURL, 'Interrupted history B', {
    startingMoney: 700,
    inputs: [{ ...leftInput, isRewarded: false, moneyAwarded: 0 }, { ...rightInput, isRewarded: true, moneyAwarded: 250 }],
  });
  const run = await launchRun(request, app.apiURL, 'Retained interrupted history', [a.configId, b.configId, a.configId]);
  const [first, partial, planned] = run.entries;
  await recordEvents(request, app.apiURL, first.sessionId, [
    ['start', '2026-10-30T11:00:00.000Z', { moneyCounter: 1250, moneyLimitReached: false, timeLimitReached: false }],
    ['click', '2026-10-30T11:00:05.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 1, clicks: { left: 1, right: 0 }, moneyCounter: 1375, awardedCents: 125 }],
    ['pause', '2026-10-30T11:00:05.000Z', {}],
    ['resume', '2026-10-30T11:00:10.000Z', {}],
    ['click', '2026-10-30T11:00:15.000Z', { inputId: 'right', inputName: 'Right', totalClicks: 2, clicks: { left: 1, right: 1 }, moneyCounter: 1375, awardedCents: 0 }],
    ['end', '2026-10-30T11:00:20.000Z', { moneyCounter: 1375, moneyLimitReached: false, timeLimitReached: false, totalClicks: 2, clicks: { left: 1, right: 1 }, pendingRewards: { left: 0, right: 0 } }],
  ]);
  await recordEvents(request, app.apiURL, partial.sessionId, [
    ['start', '2026-10-30T11:01:00.000Z', { moneyCounter: 700, moneyLimitReached: false, timeLimitReached: false }],
    ['click', '2026-10-30T11:01:05.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 1, clicks: { left: 1, right: 0 }, moneyCounter: 700, awardedCents: 0 }],
    ['pause', '2026-10-30T11:01:10.000Z', {}],
    ['resume', '2026-10-30T11:01:15.000Z', {}],
    ['click', '2026-10-30T11:01:20.000Z', { inputId: 'right', inputName: 'Right', totalClicks: 2, clicks: { left: 1, right: 1 }, moneyCounter: 950, awardedCents: 250 }],
  ]);

  await page.goto(`/sequence-history/${run.runId}`);
  await expect(page.getByRole('heading', { name: 'Retained interrupted history', exact: true })).toBeVisible();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Run sessions', exact: true });
  const rows = table.locator('tbody').getByRole('row');
  await expect(rows.nth(0).getByRole('cell').filter({ hasText: first.sessionId }).first()).toBeVisible();
  await expect(rows.nth(0).getByText('Completed', { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByRole('cell').filter({ hasText: partial.sessionId }).first()).toBeVisible();
  await expect(rows.nth(1).getByText('Active', { exact: true })).toBeVisible();
  await expect(rows.nth(2).getByRole('cell').filter({ hasText: planned.sessionId }).first()).toBeVisible();
  await expect(rows.nth(2).getByText('Planned', { exact: true })).toBeVisible();
  expect((await request.post(`${app.apiURL}/sequence-runs/${run.runId}/interrupt`)).status()).toBe(200);

  const standalone = await request.post(`${app.apiURL}/sessions/start`, {
    data: { participantId: run.participantId, configId: a.configId },
  });
  expect(standalone.status()).toBe(201);
  const { sessionId: standaloneId } = await standalone.json() as { sessionId: string };
  await recordEvents(request, app.apiURL, standaloneId, [
    ['start', '2026-10-30T11:02:00.000Z', { moneyCounter: 1250, moneyLimitReached: false, timeLimitReached: false }],
    ['click', '2026-10-30T11:02:05.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 1, clicks: { left: 1, right: 0 }, moneyCounter: 1375, awardedCents: 125 }],
    ['click', '2026-10-30T11:02:08.000Z', { inputId: 'left', inputName: 'Left', totalClicks: 2, clicks: { left: 2, right: 0 }, moneyCounter: 1500, awardedCents: 125 }],
    ['end', '2026-10-30T11:02:10.000Z', { moneyCounter: 1500, moneyLimitReached: false, timeLimitReached: false, totalClicks: 2, clicks: { left: 2, right: 0 }, pendingRewards: { left: 0, right: 0 } }],
  ]);
  const standaloneBefore = await readData(request, app.apiURL, standaloneId);
  expect(standaloneBefore).not.toHaveProperty('sequenceRunId');
  expect(standaloneBefore).not.toHaveProperty('sequencePosition');
  expect(standaloneBefore).not.toHaveProperty('sequenceStatus');

  const interrupted = await readRun(request, app.apiURL, run.runId);
  expect(interrupted).toMatchObject({
    status: 'interrupted', currentPosition: 1,
    entries: [
      { sessionId: first.sessionId, startedAt: '2026-10-30T11:00:00.000Z', endedAt: '2026-10-30T11:00:20.000Z' },
      { sessionId: partial.sessionId, startedAt: '2026-10-30T11:01:00.000Z', endedAt: null },
      { sessionId: planned.sessionId, startedAt: null, endedAt: null },
    ],
  });
  const partialData = await readData(request, app.apiURL, partial.sessionId);
  expect(partialData).toMatchObject({
    sequenceStatus: 'interrupted',
    startEvent: { value: { moneyCounter: 700 } }, endEvent: null,
    allClicks: [
      { inputId: 'left', clickInfo: { awardedCents: 0 }, sessionInfo: { moneyCounter: 700 } },
      { inputId: 'right', clickInfo: { awardedCents: 250 }, sessionInfo: { moneyCounter: 950 } },
    ],
  });
  expect(await readData(request, app.apiURL, planned.sessionId)).toMatchObject({
    sequenceStatus: 'planned', startEvent: null, endEvent: null, allClicks: [],
  });
  const listed = await request.get(`${app.apiURL}/sequence-runs`);
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ runId: run.runId, sequenceName: 'Retained interrupted history', participantId: run.participantId, status: 'interrupted' }),
  ]));

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Retained interrupted history', exact: true })).toBeVisible();
  await expect(rows).toHaveCount(3);
  for (const [index, expected] of [
    { sessionId: first.sessionId, condition: 'Interrupted history A', status: 'Completed' },
    { sessionId: partial.sessionId, condition: 'Interrupted history B', status: 'Interrupted' },
    { sessionId: planned.sessionId, condition: 'Interrupted history A', status: 'Planned' },
  ].entries()) {
    const row = rows.nth(index);
    await expect(row.getByRole('rowheader')).toHaveText(String(index + 1));
    await expect(row.getByText(expected.condition, { exact: true })).toBeVisible();
    await expect(row.getByRole('cell').filter({ hasText: expected.sessionId }).first()).toBeVisible();
    await expect(row.getByText(expected.status, { exact: true })).toBeVisible();
  }
  await expect(table.getByText(standaloneId, { exact: true })).toHaveCount(0);
  const plannedRow = rows.filter({ hasText: planned.sessionId });
  await expect(plannedRow.getByRole('link', { name: `Analytics for ${planned.sessionId}`, exact: true })).toHaveCount(0);
  await expect(plannedRow.getByRole('checkbox')).toHaveCount(0);

  for (const expected of [
    { sessionId: first.sessionId, correct: '1', rewarded: 'Left', money: '$13.75', starting: '$12.50', reason: 'Manual' },
    { sessionId: partial.sessionId, correct: '1', rewarded: 'Right', money: '$9.50', starting: '$7.00', reason: 'Interrupted' },
  ]) {
    await table.getByRole('link', { name: `Analytics for ${expected.sessionId}`, exact: true }).click();
    await expect(page).toHaveURL(`/analytics/${expected.sessionId}`);
    await expectAnalyticsMetric(page, 'Total Clicks', '2');
    await expectAnalyticsMetric(page, 'Accuracy', '50%');
    await expectAnalyticsMetric(page, 'Rewarded Input', expected.rewarded);
    await expectAnalyticsMetric(page, 'Starting Money', expected.starting);
    await expectAnalyticsMetric(page, 'Money Earned', expected.money);
    await expectAnalyticsMetric(page, 'End Reason', expected.reason);
    await expectAnalyticsMetric(page, 'Duration', '20s');
    await expectAnalyticsMetric(page, 'Active Time', '15s');
    await expectAnalyticsMetric(page, 'Paused', '5s');
    const distribution = page.getByText('Click Distribution', { exact: true }).locator('../..');
    await expect(distribution.getByText(expected.rewarded, { exact: true }).locator('..').getByText(expected.correct, { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Retained interrupted history', exact: true })).toBeVisible();
  }

  await table.getByRole('checkbox', { name: `Compare ${first.sessionId}`, exact: true }).check();
  await table.getByRole('checkbox', { name: `Compare ${partial.sessionId}`, exact: true }).check();
  await compareSelected(page).click();
  await expect(page.getByRole('heading', { name: 'Session Comparison', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.getAll('sessionId')).toEqual([first.sessionId, partial.sessionId]);
  await expect(page.getByText('2 / 5 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: new RegExp(planned.sessionId) })).toHaveCount(0);
  await page.getByRole('checkbox', { name: new RegExp(standaloneId) }).check();
  await page.getByRole('button', { name: 'Compare 3 Sessions', exact: true }).click();
  await expectComparisonMetric(page, 'Total Clicks', ['2', '2', '2']);
  await expectComparisonMetric(page, 'Correct Clicks', ['1', '1', '2']);
  await expectComparisonMetric(page, 'Accuracy', ['50%', '50%', '100%']);
  await expectComparisonMetric(page, 'Money Earned', ['$13.75', '$9.50', '$15.00']);
  await expectComparisonMetric(page, 'Duration', ['20s', '20s', '10s']);
  await expectComparisonMetric(page, 'Active Time', ['15s', '15s', '10s']);
  await expectComparisonMetric(page, 'Paused', ['5s', '5s', '0s']);
  await expectComparisonMetric(page, 'Responses / min (active)', ['8.00', '8.00', '12.00']);
  await expectComparisonMetric(page, 'Responses / min (wall)', ['6.00', '6.00', '12.00']);

  await page.goto('/');
  const participantRows = page.getByRole('row').filter({ hasText: run.participantId });
  await expect(participantRows).toHaveCount(4);
  const standaloneRow = participantRows.filter({ has: page.locator(`a[href="/analytics/${standaloneId}"]`) });
  await expect(standaloneRow.getByText('Completed', { exact: true })).toBeVisible();
  await expect(standaloneRow.getByText('$15.00', { exact: true })).toBeVisible();
  expect(await readData(request, app.apiURL, standaloneId)).toEqual(standaloneBefore);
  expect(await readData(request, app.apiURL, partial.sessionId)).toEqual(partialData);
  expect(await readData(request, app.apiURL, planned.sessionId)).toMatchObject({ startEvent: null, endEvent: null, allClicks: [] });
});

test('history caps comparison at five started entries and comparison URLs discard duplicate, planned and foreign IDs', async ({ page, request, app }) => {
  const configuration = await createConfiguration(request, app.apiURL, 'Long history condition');
  const run = await launchRun(request, app.apiURL, 'Seven-entry history', Array(7).fill(configuration.configId));
  for (const [index, timestamps] of [
    ['2026-10-30T12:00:00.000Z', '2026-10-30T12:00:05.000Z', '2026-10-30T12:00:10.000Z'],
    ['2026-10-30T12:01:00.000Z', '2026-10-30T12:01:05.000Z', '2026-10-30T12:01:10.000Z'],
    ['2026-10-30T12:02:00.000Z', '2026-10-30T12:02:05.000Z', '2026-10-30T12:02:10.000Z'],
    ['2026-10-30T12:03:00.000Z', '2026-10-30T12:03:05.000Z', '2026-10-30T12:03:10.000Z'],
    ['2026-10-30T12:04:00.000Z', '2026-10-30T12:04:05.000Z', '2026-10-30T12:04:10.000Z'],
    ['2026-10-30T12:05:00.000Z', '2026-10-30T12:05:05.000Z', '2026-10-30T12:05:10.000Z'],
  ].entries()) {
    await recordEvents(request, app.apiURL, run.entries[index].sessionId, [
      ['start', timestamps[0], { moneyCounter: 1250, moneyLimitReached: false, timeLimitReached: false }],
      ['click', timestamps[1], { inputId: 'left', inputName: 'Left', totalClicks: 1, clicks: { left: 1, right: 0 }, moneyCounter: 1375, awardedCents: 125 }],
      ['end', timestamps[2], { moneyCounter: 1375, moneyLimitReached: false, timeLimitReached: false, totalClicks: 1, clicks: { left: 1, right: 0 }, pendingRewards: { left: 0, right: 0 } }],
    ]);
  }
  const foreign = await request.post(`${app.apiURL}/sessions/start`, {
    data: { participantId: `other-participant-${randomUUID()}`, configId: configuration.configId },
  });
  expect(foreign.status()).toBe(201);
  const { sessionId: foreignId } = await foreign.json() as { sessionId: string };
  await recordEvents(request, app.apiURL, foreignId, [
    ['start', '2026-10-30T13:00:00.000Z', { moneyCounter: 1250, moneyLimitReached: false, timeLimitReached: false }],
  ]);

  await page.goto(`/sequence-history/${run.runId}`);
  await expect(page.getByRole('heading', { name: 'Seven-entry history', exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Run sessions', exact: true });
  await expect(table.locator('tbody').getByRole('row')).toHaveCount(7);
  await expect(compareSelected(page)).toBeDisabled();
  await expect(table.getByRole('checkbox')).toHaveCount(6);
  for (const index of [4, 2, 0, 3, 1]) {
    await table.getByRole('checkbox', { name: `Compare ${run.entries[index].sessionId}`, exact: true }).check();
  }
  const sixth = table.getByRole('checkbox', { name: `Compare ${run.entries[5].sessionId}`, exact: true });
  await expect(sixth).toBeDisabled();
  await expect(sixth).not.toBeChecked();
  const third = table.getByRole('checkbox', { name: `Compare ${run.entries[2].sessionId}`, exact: true });
  await third.focus();
  await page.keyboard.press('Space');
  await expect(third).not.toBeChecked();
  await expect(sixth).toBeEnabled();
  await sixth.check();
  await expect(third).toBeDisabled();
  await compareSelected(page).click();

  const selectedIds = [run.entries[0].sessionId, run.entries[1].sessionId, run.entries[3].sessionId, run.entries[4].sessionId, run.entries[5].sessionId];
  await expect(page.getByRole('heading', { name: 'Session Comparison', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('participantId')).toBe(run.participantId);
  expect(new URL(page.url()).searchParams.getAll('sessionId')).toEqual(selectedIds);
  await expect(page.getByText('5 / 5 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare 5 Sessions', exact: true }).click();
  const stats = page.getByText('Stats Comparison', { exact: true }).locator('../..');
  await expect(stats.getByRole('link')).toHaveText(selectedIds);
  await expectComparisonMetric(page, 'Total Clicks', ['1', '1', '1', '1', '1']);
  await expectComparisonMetric(page, 'Money Earned', ['$13.75', '$13.75', '$13.75', '$13.75', '$13.75']);

  const query = new URLSearchParams({ participantId: run.participantId });
  for (const sessionId of [
    run.entries[6].sessionId, 'missing-history-session',
    run.entries[5].sessionId, run.entries[5].sessionId, foreignId,
    run.entries[2].sessionId, run.entries[4].sessionId, run.entries[0].sessionId,
    run.entries[3].sessionId, run.entries[1].sessionId,
  ]) query.append('sessionId', sessionId);
  await page.goto(`/compare?${query}`);
  await expect(page.getByRole('heading', { name: 'Session Comparison', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveValue(run.participantId);
  await expect(page.getByText('5 / 5 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(6);
  for (const sessionId of [run.entries[6].sessionId, 'missing-history-session', foreignId]) {
    await expect(page.getByRole('checkbox', { name: new RegExp(sessionId) })).toHaveCount(0);
  }
  const sanitizedIds = [run.entries[5].sessionId, run.entries[2].sessionId, run.entries[4].sessionId, run.entries[0].sessionId, run.entries[3].sessionId];
  for (const sessionId of sanitizedIds) {
    await expect(page.getByRole('checkbox', { name: new RegExp(sessionId) })).toBeChecked();
  }
  const excludedSixth = page.getByRole('checkbox', { name: new RegExp(run.entries[1].sessionId) });
  await expect(excludedSixth).not.toBeChecked();
  await expect(excludedSixth).toBeDisabled();
  await page.getByRole('button', { name: 'Compare 5 Sessions', exact: true }).click();
  await expect(stats.getByRole('link')).toHaveText(sanitizedIds);
  await expectComparisonMetric(page, 'Correct Clicks', ['1', '1', '1', '1', '1']);
  expect(await readData(request, app.apiURL, run.entries[6].sessionId)).toMatchObject({
    sequenceStatus: 'planned', startEvent: null, endEvent: null, allClicks: [],
  });
});
