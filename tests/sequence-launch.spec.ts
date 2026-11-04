import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import type { BaseConfig, SequenceRun } from '../client/src/types';

test('leaving sequence setup before launch acknowledgement keeps Home and planned sessions unstarted', async ({ page, request, app }) => {
  const configId = `launch-browser-${randomUUID()}`;
  const config: BaseConfig = {
    timeLimit: 30, moneyLimit: 500, startingMoney: 200, continueAfterMoneyLimit: false,
    showMoneyToParticipant: true, pauseEnabled: false, changeoverDelayEnabled: false,
    inputs: [{
      id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
      isRewarded: true, moneyAwarded: 300, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
    }],
  };
  expect((await request.post(`${app.apiURL}/configurations`, {
    data: { configId, name: 'Delayed launch condition', config },
  })).status()).toBe(201);
  const saved = await request.post(`${app.apiURL}/sequences`, {
    data: { name: `Delayed launch ${randomUUID()}`, configIds: [configId, configId] },
  });
  expect(saved.status()).toBe(201);
  const sequence: { sequenceId: string; name: string } = await saved.json();
  const launchURL = `${app.apiURL}/sequences/${sequence.sequenceId}/runs`;
  let markPersisted!: (run: SequenceRun) => void;
  let releaseResponse!: () => void;
  const persisted = new Promise<SequenceRun>(resolve => { markPersisted = resolve; });
  const released = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route(launchURL, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    markPersisted(await response.json() as SequenceRun);
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/sequences');
    await page.getByRole('button', { name: `Start ${sequence.name}`, exact: true }).click();
    await page.getByLabel('Participant ID', { exact: true }).fill(`participant-${randomUUID()}`);
    await page.getByRole('button', { name: 'Start Sequence', exact: true }).click();
    const run = await persisted;
    expect(run.entries.map(entry => entry.startedAt)).toEqual([null, null]);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL('/');
    const acknowledged = page.waitForResponse(launchURL);
    releaseResponse();
    expect(await (await acknowledged).finished()).toBeNull();
    await page.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect.soft(page).toHaveURL('/');
    const retrieved = await request.get(`${app.apiURL}/sequence-runs/${run.runId}`);
    expect(retrieved.status()).toBe(200);
    const planned: SequenceRun = await retrieved.json();
    expect.soft(planned.entries.map(entry => entry.startedAt)).toEqual([null, null]);
    for (const entry of planned.entries) {
      const data = await request.get(`${app.apiURL}/sessions/${entry.sessionId}/data`);
      expect(data.status()).toBe(200);
      expect.soft((await data.json()).startEvent).toBeNull();
      const events = await request.get(`${app.apiURL}/events/${entry.sessionId}`);
      expect(events.status()).toBe(200);
      expect.soft(await events.json()).toEqual([]);
    }
    await expect(page.getByRole('group', { name: 'Participant apparatus', exact: true })).toBeHidden();
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
