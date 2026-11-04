import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import type { BaseConfig, SequenceRun } from '../client/src/types';
import { test, expect } from './fixtures';

type AudioEvent = { event: string; currentTime: number; duration: number; apparatusDisabled: boolean };
type AudioObservation = { events: AudioEvent[]; fulfilled: number; rejected: string[] };
declare global {
  interface Window {
    rewardAudio: AudioObservation;
  }
}

async function observeNativeAudio(page: Page) {
  await page.addInitScript(() => {
    const observation: AudioObservation = { events: [], fulfilled: 0, rejected: [] };
    window.rewardAudio = observation;
    const observed = new WeakSet<HTMLMediaElement>();
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!observed.has(this)) {
        observed.add(this);
        for (const event of ['playing', 'timeupdate', 'pause', 'ended']) {
          this.addEventListener(event, () => {
            const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Participant apparatus"] button')];
            observation.events.push({
              event, currentTime: this.currentTime, duration: this.duration,
              apparatusDisabled: buttons.length > 0 && buttons.every(button => button.disabled),
            });
          });
        }
      }
      // Observe the native playback promise without replacing playback or its result.
      const playing = nativePlay.call(this);
      void playing.then(() => { observation.fulfilled += 1; }, error => {
        observation.rejected.push(error instanceof Error ? error.name : String(error));
      });
      return playing;
    };
  });
}

async function createSoundConfiguration(request: APIRequestContext, apiURL: string, moneyLimit = 500) {
  const configId = `sound-${randomUUID()}`;
  const config: BaseConfig = {
    timeLimit: 30, startingMoney: 200, moneyLimit, continueAfterMoneyLimit: false,
    inputs: [{
      id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
      isRewarded: true, moneyAwarded: 300, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: true,
    }],
  };
  const created = await request.post(`${apiURL}/configurations`, { data: { configId, name: 'Audible final reward', config } });
  expect(created.status()).toBe(201);
  return configId;
}

async function readAudio(page: Page) {
  return page.evaluate(() => window.rewardAudio);
}

test('standalone final money-limit reward plays native audio after apparatus stops and results are saved', async ({ page, request, app }) => {
  await observeNativeAudio(page);
  const configId = await createSoundConfiguration(request, app.apiURL);
  const started = await request.post(`${app.apiURL}/sessions/start`, {
    data: { participantId: `sound-participant-${randomUUID()}`, configId },
  });
  expect(started.status()).toBe(201);
  const { sessionId } = await started.json() as { sessionId: string };
  await page.goto(`/session/${sessionId}`);
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  await expect(button).toBeEnabled();
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${sessionId}/end`);
  await button.click();
  expect((await ended).status()).toBe(200);
  await expect(button).toBeDisabled();
  await expect(page.getByText('Money limit reached. Session ended.', { exact: true })).toBeVisible();
  const data = await request.get(`${app.apiURL}/sessions/${sessionId}/data`);
  expect(data.status()).toBe(200);
  expect(await data.json()).toMatchObject({
    allClicks: [{ clickInfo: { total: 1, awardedCents: 300 }, sessionInfo: { moneyCounter: 500 } }],
    endEvent: { value: { moneyCounter: 500, totalClicks: 1, moneyLimitReached: true } },
  });
  await expect.poll(() => readAudio(page)).toMatchObject({ fulfilled: 1, rejected: [] });
  await expect.poll(async () => (await readAudio(page)).events).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'playing', apparatusDisabled: true }),
    expect.objectContaining({ event: 'timeupdate', currentTime: expect.any(Number), apparatusDisabled: true }),
  ]));
  await expect.poll(async () => (await readAudio(page)).events.some(event =>
    event.event === 'ended' && event.currentTime > 0.5 && event.apparatusDisabled), { timeout: 10_000 }).toBe(true);
  expect((await readAudio(page)).rejected).toEqual([]);
});

test('sequence boundary and final rewards both play native audio without delaying the next condition', async ({ page, request, app }) => {
  await observeNativeAudio(page);
  const configId = await createSoundConfiguration(request, app.apiURL);
  const saved = await request.post(`${app.apiURL}/sequences`, {
    data: { name: `Audible boundaries ${randomUUID()}`, configIds: [configId, configId] },
  });
  expect(saved.status()).toBe(201);
  const { sequenceId } = await saved.json() as { sequenceId: string };
  const launched = await request.post(`${app.apiURL}/sequences/${sequenceId}/runs`, {
    data: { participantId: `sound-participant-${randomUUID()}` },
  });
  expect(launched.status()).toBe(201);
  const run = await launched.json() as SequenceRun;
  await page.goto(`/sequence-run?runId=${encodeURIComponent(run.runId)}`);
  const button = page.getByRole('button', { name: 'Click Me', exact: true });
  await expect(button).toBeEnabled();
  const nextStarted = page.waitForResponse(response => response.url() === `${app.apiURL}/events`
    && response.request().method() === 'POST'
    && response.request().postDataJSON().sessionId === run.entries[1].sessionId
    && response.request().postDataJSON().event === 'start');
  await button.click();
  expect((await nextStarted).status()).toBe(201);
  await expect(button).toBeEnabled();
  await expect.poll(() => readAudio(page)).toMatchObject({ fulfilled: 1, rejected: [] });
  expect((await readAudio(page)).events.some(event => event.event === 'ended')).toBe(false);
  await expect.poll(async () => (await readAudio(page)).events.some(event =>
    event.event === 'ended' && event.currentTime > 0.5), { timeout: 10_000 }).toBe(true);
  const first = await request.get(`${app.apiURL}/sessions/${run.entries[0].sessionId}/data`);
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({
    allClicks: [{ clickInfo: { total: 1, awardedCents: 300 } }],
    endEvent: { value: { moneyCounter: 500, totalClicks: 1, moneyLimitReached: true } },
  });
  const ended = page.waitForResponse(`${app.apiURL}/sessions/${run.entries[1].sessionId}/end`);
  await button.click();
  expect((await ended).status()).toBe(200);
  await expect(page.getByText('Session complete.', { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  await expect.poll(() => readAudio(page)).toMatchObject({ fulfilled: 2, rejected: [] });
  await expect.poll(async () => (await readAudio(page)).events.filter(event =>
    event.event === 'ended' && event.currentTime > 0.5).length, { timeout: 10_000 }).toBe(2);
  const second = await request.get(`${app.apiURL}/sessions/${run.entries[1].sessionId}/data`);
  expect(second.status()).toBe(200);
  expect(await second.json()).toMatchObject({
    allClicks: [{ clickInfo: { total: 1, awardedCents: 300 } }],
    endEvent: { value: { moneyCounter: 500, totalClicks: 1, moneyLimitReached: true } },
  });
  const completed = await request.get(`${app.apiURL}/sequence-runs/${run.runId}`);
  expect(completed.status()).toBe(200);
  expect(await completed.json()).toMatchObject({ status: 'completed', sequenceBalance: 800 });
});

for (const cancellation of ['save failure', 'navigation'] as const) {
  test(`native reward playback still cancels on ${cancellation}`, async ({ page, request, app }) => {
    await observeNativeAudio(page);
    const configId = await createSoundConfiguration(request, app.apiURL, 5000);
    const started = await request.post(`${app.apiURL}/sessions/start`, {
      data: { participantId: `sound-participant-${randomUUID()}`, configId },
    });
    expect(started.status()).toBe(201);
    const { sessionId } = await started.json() as { sessionId: string };
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    if (cancellation === 'save failure') {
      await page.route(`${app.apiURL}/events`, async route => {
        const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
        if (body?.sessionId !== sessionId || body.event !== 'click') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        await held;
        await route.fulfill({ response, status: 503, json: { error: 'Injected response failure after saving click' } });
      });
    }
    try {
      await page.goto(`/session/${sessionId}`);
      const button = page.getByRole('button', { name: 'Click Me', exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      await expect.poll(() => readAudio(page)).toMatchObject({ fulfilled: 1, rejected: [] });
      await expect.poll(async () => (await readAudio(page)).events.some(event =>
        event.event === 'timeupdate' && event.currentTime > 0.1)).toBe(true);
      if (cancellation === 'save failure') {
        release();
        await expect(page.getByRole('alert')).toContainText('data could not be saved');
      } else {
        await page.getByRole('link', { name: 'Home', exact: true }).click();
        await expect(page).toHaveURL('/');
      }
      await expect.poll(async () => (await readAudio(page)).events.some(event =>
        event.event === 'pause' && event.currentTime > 0 && event.currentTime < event.duration)).toBe(true);
      expect((await readAudio(page)).events.some(event => event.event === 'ended')).toBe(false);
      const data = await request.get(`${app.apiURL}/sessions/${sessionId}/data`);
      expect(data.status()).toBe(200);
      expect(await data.json()).toMatchObject({ allClicks: [{ clickInfo: { total: 1, awardedCents: 300 } }], endEvent: null });
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
