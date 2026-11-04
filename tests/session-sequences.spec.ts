import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

async function createConfiguration(request: APIRequestContext, apiURL: string, name: string) {
  const configId = `sequence-${randomUUID()}`;
  const config = {
    timeLimit: 120, moneyLimit: 500, startingMoney: 0, continueAfterMoneyLimit: false,
    inputs: [{
      id: 'reward', name: 'Reward', type: 'screen', shape: 'rectangle', color: '#2563eb',
      isRewarded: true, moneyAwarded: 10, awardInterval: 5, playAwardSound: false,
    }],
  };
  const response = await request.post(`${apiURL}/configurations`, { data: { configId, name, config } });
  expect(response.status()).toBe(201);
  return { configId, name, config };
}

test('researcher saves, reopens, renames, reorders and deletes an A B A sequence', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Condition A');
  const b = await createConfiguration(request, app.apiURL, 'Condition B');
  await page.goto('/');
  await page.getByRole('link', { name: 'Session Sequences', exact: true }).click();
  await page.getByRole('button', { name: 'Create Sequence', exact: true }).click();
  await page.getByLabel('Sequence name').fill('Alternating conditions');
  for (const configId of [a.configId, b.configId, a.configId]) {
    await page.getByLabel('Configuration', { exact: true }).selectOption(configId);
    await page.getByRole('button', { name: 'Add Configuration', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Save Sequence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alternating conditions', exact: true })).toBeVisible();
  const sequences = await request.get(`${app.apiURL}/sequences`);
  expect(sequences.status()).toBe(200);
  const saved = (await sequences.json()).find((sequence: { name: string }) => sequence.name === 'Alternating conditions');
  expect(saved.configIds).toEqual([a.configId, b.configId, a.configId]);

  await page.reload();
  await page.getByRole('button', { name: 'Edit Alternating conditions', exact: true }).click();
  await expect(page.getByLabel('Sequence name')).toHaveValue('Alternating conditions');
  await expect(page.getByRole('list', { name: 'Sequence entries' }).getByRole('listitem')).toHaveText([
    /1\. Condition A/, /2\. Condition B/, /3\. Condition A/,
  ]);
  await page.getByLabel('Sequence name').fill('Revised conditions');
  await page.getByRole('button', { name: 'Move entry 2 up', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save Sequence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revised conditions', exact: true })).toBeVisible();
  await page.reload();
  const revised = await request.get(`${app.apiURL}/sequences/${saved.sequenceId}`);
  expect(revised.status()).toBe(200);
  expect(await revised.json()).toMatchObject({ name: 'Revised conditions', configIds: [b.configId, a.configId, a.configId] });
  await page.getByRole('button', { name: 'Edit Revised conditions', exact: true }).click();
  await page.getByRole('button', { name: 'Remove entry 3', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save Sequence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revised conditions', exact: true })).toBeVisible();
  expect(await (await request.get(`${app.apiURL}/sequences/${saved.sequenceId}`)).json()).toMatchObject({ configIds: [b.configId, a.configId] });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Revised conditions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revised conditions', exact: true })).toHaveCount(0);
  expect((await request.get(`${app.apiURL}/sequences/${saved.sequenceId}`)).status()).toBe(404);
  expect((await request.get(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(200);
  expect((await request.get(`${app.apiURL}/configurations/${b.configId}`)).status()).toBe(200);
});

test('invalid sequence submissions never create or partially revise saved setups', async ({ request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Validation A');
  const b = await createConfiguration(request, app.apiURL, 'Validation B');
  const invalidBodies = [
    {},
    { name: '   ', configIds: [a.configId] },
    { name: 'x'.repeat(201), configIds: [a.configId] },
    { name: 42, configIds: [a.configId] },
    { name: 'Invalid', configIds: [] },
    { name: 'Invalid', configIds: { 0: a.configId } },
    { name: 'Invalid', configIds: [null] },
    { name: 'Invalid', configIds: [''] },
    { name: 'Invalid', configIds: [a.configId, 'missing-configuration'] },
  ];
  const before = await (await request.get(`${app.apiURL}/sequences`)).json();
  for (const data of invalidBodies) {
    const response = await request.post(`${app.apiURL}/sequences`, { data });
    expect(response.status(), JSON.stringify(data)).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  }
  expect(await (await request.get(`${app.apiURL}/sequences`)).json()).toEqual(before);
  const created = await request.post(`${app.apiURL}/sequences`, {
    data: { name: '  Original  ', configIds: [a.configId, b.configId, a.configId] },
  });
  expect(created.status()).toBe(201);
  const saved = await created.json();
  expect(saved.name).toBe('Original');
  for (const data of invalidBodies) {
    const response = await request.put(`${app.apiURL}/sequences/${saved.sequenceId}`, { data });
    expect(response.status(), JSON.stringify(data)).toBe(400);
    expect(await (await request.get(`${app.apiURL}/sequences/${saved.sequenceId}`)).json()).toEqual(saved);
  }
});

test('configuration deletion guards retain research data and release only unused setup references', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Protected A');
  const b = await createConfiguration(request, app.apiURL, 'Protected B');
  const started = await request.post(`${app.apiURL}/sessions/start`, {
    data: { participantId: `participant-${randomUUID()}`, configId: a.configId },
  });
  expect(started.status()).toBe(201);
  const { sessionId } = await started.json();
  const logged = await request.post(`${app.apiURL}/events`, {
    data: { sessionId, event: 'click', value: { inputId: 'reward', inputName: 'Reward', totalClicks: 1, moneyCounter: 10, awardedCents: 10 } },
  });
  expect(logged.status()).toBe(201);
  const ended = await request.post(`${app.apiURL}/sessions/${sessionId}/end`, {
    data: {
      value: { moneyCounter: 10, totalClicks: 1, clicks: { reward: 1 }, pendingRewards: { reward: 0 }, moneyLimitReached: false, timeLimitReached: true },
    },
  });
  expect(ended.status()).toBe(200);
  const notes = await request.put(`${app.apiURL}/sessions/${sessionId}/notes`, { data: { notes: 'Retain these observations' } });
  expect(notes.status()).toBe(200);
  const before = await (await request.get(`${app.apiURL}/sessions/${sessionId}/data`)).json();
  const created = await request.post(`${app.apiURL}/sequences`, {
    data: { name: 'Protected setup', configIds: [a.configId, b.configId, a.configId] },
  });
  expect(created.status()).toBe(201);
  const saved = await created.json();
  const second = await request.post(`${app.apiURL}/sequences`, {
    data: { name: 'Other setup', configIds: [a.configId] },
  });
  expect(second.status()).toBe(201);
  const other = await second.json();
  await page.goto('/sequences');
  const blocked = await page.evaluate(async ({ apiURL, configId }) => {
    const response = await fetch(`${apiURL}/configurations/${configId}`, { method: 'DELETE' });
    return { status: response.status, body: await response.json() };
  }, { apiURL: app.apiURL, configId: a.configId });
  expect(blocked.status).toBe(409);
  expect(blocked.body.error).toMatch(/sequence/i);
  expect(await (await request.get(`${app.apiURL}/sequences/${saved.sequenceId}`)).json()).toEqual(saved);
  expect(await (await request.get(`${app.apiURL}/sessions/${sessionId}/data`)).json()).toEqual(before);
  expect(await (await request.get(`${app.apiURL}/sessions/${sessionId}/notes`)).json()).toMatchObject({ notes: 'Retain these observations' });

  const edited = await request.put(`${app.apiURL}/configurations/${a.configId}`, { data: { name: 'Edited A', config: { ...a.config, timeLimit: 240 } } });
  expect(edited.status()).toBe(200);
  expect(await (await request.get(`${app.apiURL}/configurations/${a.configId}`)).json()).toMatchObject({ name: 'Edited A' });
  const revised = await request.put(`${app.apiURL}/sequences/${saved.sequenceId}`, {
    data: { name: 'A only', configIds: [a.configId] },
  });
  expect(revised.status()).toBe(200);
  expect((await request.delete(`${app.apiURL}/configurations/${b.configId}`)).status()).toBe(200);
  expect((await request.delete(`${app.apiURL}/sequences/${saved.sequenceId}`)).status()).toBe(200);
  expect((await request.delete(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(409);
  expect((await request.delete(`${app.apiURL}/sequences/${other.sequenceId}`)).status()).toBe(200);
  expect((await request.get(`${app.apiURL}/sessions/${sessionId}/data`)).status()).toBe(200);
  expect((await request.get(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(200);
  // Standalone deletion semantics remain unchanged after every setup releases its reference.
  expect((await request.delete(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(200);
});

test('empty entries and stale configuration references report errors without losing the draft', async ({ page, request, app }) => {
  const a = await createConfiguration(request, app.apiURL, 'Temporary condition');
  await page.goto('/sequences');
  await page.getByRole('button', { name: 'Create Sequence', exact: true }).click();
  await page.getByLabel('Sequence name').fill('Draft conditions');
  await page.getByRole('button', { name: 'Save Sequence', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/configuration/i);
  await page.getByLabel('Configuration', { exact: true }).selectOption(a.configId);
  await page.getByRole('button', { name: 'Add Configuration', exact: true }).click();
  expect((await request.delete(`${app.apiURL}/configurations/${a.configId}`)).status()).toBe(200);
  await page.getByRole('button', { name: 'Save Sequence', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/configuration/i);
  await expect(page.getByLabel('Sequence name')).toHaveValue('Draft conditions');
  await expect(page.getByRole('list', { name: 'Sequence entries' }).getByRole('listitem')).toHaveText([/1\. Temporary condition/]);
  const listed = await request.get(`${app.apiURL}/sequences`);
  expect((await listed.json()).filter((sequence: { name: string }) => sequence.name === 'Draft conditions')).toEqual([]);
});
