import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import type { APIRequestContext, Page } from '@playwright/test';
import type { BaseConfig, SequenceRun } from '../client/src/types';
import { test as base, expect } from './fixtures';

const root = resolve(__dirname, '..');
const executeFile = promisify(execFile);

type StaticApp = { url: string; generatedRunIds: string[] };
const test = base.extend<{}, { staticApp: StaticApp }>({
  staticApp: [async ({ app }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'easterseals-static-'));
    const output = join(directory, 'dist');
    let server: Server | undefined;
    try {
      const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
      await executeFile(process.execPath, [vite, 'build', '--outDir', output, '--emptyOutDir'], {
        cwd: join(root, 'client'),
        env: { ...process.env, NODE_ENV: 'production', VITE_API_URL: app.apiURL },
        windowsHide: true, timeout: 60_000, maxBuffer: 2_000_000,
      });
      const snapshot = await fetch(`${app.apiURL}/sequence-runs`);
      expect(snapshot.status).toBe(200);
      const generatedRunIds = (await snapshot.json() as SequenceRun[]).map(run => run.runId);
      await executeFile(process.execPath, [join(root, 'client/scripts/generate-spa-fallbacks.mjs'), output], {
        cwd: root,
        env: { ...process.env, SPA_FALLBACK_API_BASE_URL: app.apiURL },
        windowsHide: true, timeout: 30_000,
      });
      const staticServer = express();
      // Deliberately no SPA wildcard: a missing deployment fallback must return 404.
      staticServer.use(express.static(output));
      server = staticServer.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Static test server did not allocate a port');
      await use({ url: `http://127.0.0.1:${address.port}`, generatedRunIds });
    } finally {
      if (server?.listening) {
        server.closeAllConnections();
        await promisify(server.close.bind(server))();
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, { scope: 'worker', timeout: 120_000 }],
});

async function launchRun(request: APIRequestContext, apiURL: string, limits: number[]) {
  const configIds: string[] = [];
  for (const moneyLimit of limits) {
    const configId = `static-config-${randomUUID()}`;
    const config: BaseConfig = {
      timeLimit: 300, startingMoney: 200, moneyLimit, continueAfterMoneyLimit: false,
      inputs: [{
        id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
        isRewarded: true, moneyAwarded: 300, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
      }],
    };
    const created = await request.post(`${apiURL}/configurations`, { data: { configId, name: 'Post-deployment condition', config } });
    expect(created.status()).toBe(201);
    configIds.push(configId);
  }
  const saved = await request.post(`${apiURL}/sequences`, { data: { name: `Post-deployment ${randomUUID()}`, configIds } });
  expect(saved.status()).toBe(201);
  const sequence = await saved.json() as { sequenceId: string };
  const launched = await request.post(`${apiURL}/sequences/${sequence.sequenceId}/runs`, {
    data: { participantId: `static-participant-${randomUUID()}` },
  });
  expect(launched.status()).toBe(201);
  return launched.json() as Promise<SequenceRun>;
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

async function clickAndSave(page: Page, apiURL: string, sessionId: string) {
  const saved = page.waitForResponse(response => response.url() === `${apiURL}/events`
    && response.request().method() === 'POST'
    && response.request().postDataJSON().sessionId === sessionId
    && response.request().postDataJSON().event === 'click');
  await page.getByRole('button', { name: 'Click Me', exact: true }).click();
  expect((await saved).status()).toBe(201);
}

test('static fallback serves a newly launched run after generation and completed reopening never replays results', async ({ page, request, app, staticApp }) => {
  const run = await launchRun(request, app.apiURL, [500]);
  expect(staticApp.generatedRunIds).not.toContain(run.runId);
  const url = `${staticApp.url}/sequence-run?runId=${encodeURIComponent(run.runId)}`;
  expect((await page.goto(url))?.status()).toBe(200);
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  await expect(button).toBeEnabled();
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${run.entries[0].sessionId}/end`);
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  const completed = await readRun(request, app.apiURL, run.runId);
  expect(completed).toMatchObject({ status: 'completed', currentPosition: 1, sequenceBalance: 500 });
  const saved = await readData(request, app.apiURL, run.entries[0].sessionId);
  expect(saved.endEvent.value).toMatchObject({ moneyCounter: 500, totalClicks: 1, moneyLimitReached: true });
  const events = await readEvents(request, app.apiURL, run.entries[0].sessionId);
  expect(events.map(event => event.event)).toEqual(['start', 'click', 'end']);
  for (const reopen of ['reload', 'new document']) {
    if (reopen === 'reload') expect((await page.reload())?.status()).toBe(200);
    else {
      await page.goto('about:blank');
      expect((await page.goto(url))?.status()).toBe(200);
    }
    await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
    await expect(button).toBeDisabled();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.keyboard.press('Space');
    expect(await readRun(request, app.apiURL, run.runId)).toEqual(completed);
    expect(await readData(request, app.apiURL, run.entries[0].sessionId)).toEqual(saved);
    expect(await readEvents(request, app.apiURL, run.entries[0].sessionId)).toEqual(events);
  }
});

test('static active reload recovers a rejected keepalive exit fetch and retains completed partial and planned records without replay', async ({ page, request, app, staticApp }) => {
  const run = await launchRun(request, app.apiURL, [500, 5000, 500]);
  expect(staticApp.generatedRunIds).not.toContain(run.runId);
  const url = `${staticApp.url}/sequence-run?runId=${encodeURIComponent(run.runId)}`;
  expect((await page.goto(url))?.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await clickAndSave(page, app.apiURL, run.entries[0].sessionId);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await clickAndSave(page, app.apiURL, run.entries[1].sessionId);
  const completed = await readData(request, app.apiURL, run.entries[0].sessionId);
  const partial = await readData(request, app.apiURL, run.entries[1].sessionId);
  expect(completed.endEvent.value).toMatchObject({ moneyCounter: 500, totalClicks: 1 });
  expect(partial.allClicks).toHaveLength(1);
  expect(partial.endEvent).toBeNull();
  const interruptURL = `${app.apiURL}/sequence-runs/${run.runId}/interrupt`;
  // Reject only the outgoing document's keepalive fetch; re-entry uses the real API.
  await page.evaluate(interruptURL => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => input === interruptURL && init?.keepalive
      ? Promise.reject(new TypeError('Failed to fetch'))
      : fetch(input, init);
  }, interruptURL);
  const reentrySnapshot = page.waitForResponse(response =>
    response.url() === `${app.apiURL}/sequence-runs/${run.runId}` && response.request().method() === 'GET');
  const reentryInterruption = page.waitForResponse(response =>
    response.url() === interruptURL && response.request().method() === 'POST');
  expect((await page.reload())?.status()).toBe(200);
  expect(await (await reentrySnapshot).json()).toMatchObject({ status: 'running', currentPosition: 1, sequenceBalance: 800 });
  expect((await reentryInterruption).status()).toBe(200);
  await expect(page.getByRole('alert')).toContainText(/interrupted/i);
  const interrupted = await readRun(request, app.apiURL, run.runId);
  expect(interrupted).toMatchObject({ status: 'interrupted', currentPosition: 1, sequenceBalance: 800 });
  expect(interrupted.entries[1].endedAt).toBeNull();
  expect(interrupted.entries[2]).toMatchObject({ startedAt: null, endedAt: null });
  const partialEvents = await readEvents(request, app.apiURL, run.entries[1].sessionId);
  expect(partialEvents.map(event => event.event)).toEqual(['start', 'click']);
  for (let visit = 0; visit < 2; visit++) {
    if (visit === 0) expect((await page.reload())?.status()).toBe(200);
    else {
      await page.goto('about:blank');
      expect((await page.goto(url))?.status()).toBe(200);
    }
    await expect(page.getByRole('alert')).toContainText(/interrupted/i);
    await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeHidden();
    await page.keyboard.press('Space');
    expect(await readRun(request, app.apiURL, run.runId)).toEqual(interrupted);
    expect(await readData(request, app.apiURL, run.entries[0].sessionId)).toEqual(completed);
    expect(await readData(request, app.apiURL, run.entries[1].sessionId)).toEqual({ ...partial, sequenceStatus: 'interrupted' });
    expect(await readEvents(request, app.apiURL, run.entries[1].sessionId)).toEqual(partialEvents);
    expect(await readEvents(request, app.apiURL, run.entries[2].sessionId)).toEqual([]);
  }
});

test('query-only participant navigation retires the old run before a fresh post-generation run accepts input', async ({ page, request, app, staticApp }) => {
  const oldRun = await launchRun(request, app.apiURL, [5000, 500]);
  const fresh = await launchRun(request, app.apiURL, [500]);
  expect(staticApp.generatedRunIds).not.toContain(oldRun.runId);
  expect(staticApp.generatedRunIds).not.toContain(fresh.runId);
  expect((await page.goto(`${staticApp.url}/sequence-run?runId=${encodeURIComponent(oldRun.runId)}`))?.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await clickAndSave(page, app.apiURL, oldRun.entries[0].sessionId);
  const saved = await readData(request, app.apiURL, oldRun.entries[0].sessionId);
  const interrupted = page.waitForResponse(`${app.apiURL}/sequence-runs/${oldRun.runId}/interrupt`);
  await page.evaluate(runId => {
    window.history.pushState({}, '', `/sequence-run?runId=${encodeURIComponent(runId)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, fresh.runId);
  expect((await interrupted).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Click Me', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Balance', { exact: true })).toHaveText('$2.00');
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${fresh.entries[0].sessionId}/end`);
  await clickAndSave(page, app.apiURL, fresh.entries[0].sessionId);
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
  expect(await readRun(request, app.apiURL, oldRun.runId)).toMatchObject({ status: 'interrupted', currentPosition: 0, sequenceBalance: 500 });
  expect(await readData(request, app.apiURL, oldRun.entries[0].sessionId)).toEqual({ ...saved, sequenceStatus: 'interrupted' });
  expect(await readEvents(request, app.apiURL, oldRun.entries[1].sessionId)).toEqual([]);
  expect(await readRun(request, app.apiURL, fresh.runId)).toMatchObject({ status: 'completed', currentPosition: 1, sequenceBalance: 500 });
});
