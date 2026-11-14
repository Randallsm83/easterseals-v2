#!/usr/bin/env node
// Browser journeys for verify-easterseals-v2. Run through `control.sh drive <journey> [--key value ...]`,
// which supplies ES_WEB, ES_API, ES_DB and ES_EVID from the running instance.
// Uses the repo's own playwright-core (from @playwright/test) with the installed Google Chrome.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const { ES_WEB, ES_DB, ES_EVID } = process.env;
if (!ES_WEB || !ES_DB || !ES_EVID) throw new Error('run via control.sh drive (ES_WEB/ES_DB/ES_EVID unset)');

const [journey, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];

const config = opts.config ?? 'Verify fixed 10s';
const timeLimit = Number(opts['time-limit'] ?? 10);
const clicks = Number(opts.clicks ?? 10);
const participant = opts.participant ?? `V${Date.now() % 100000}`;

// One directory per invocation so a rerun never mixes with an earlier attempt's artifacts.
const outDir = join(ES_EVID, `${journey ?? 'none'}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`);
mkdirSync(outDir, { recursive: true });
const steps = [];
let seq = 0;
const pad = () => String(++seq).padStart(2, '0');

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const money = cents => `$${(cents / 100).toFixed(2)}`;
// Default config from ConfigurationSetup: only "Left" (first Click Me) is rewarded, 5 cents every 10 clicks.
const earned = n => money(Math.floor(n / 10) * 5);
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// sqlite3 >= 3.52 prints headers in its default mode, so always read with -json.
function dbq(sql) {
  const out = execFileSync('sqlite3', ['-readonly', '-json', ES_DB, sql], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
}

function db(label, sql) {
  const rows = dbq(sql);
  writeFileSync(join(outDir, `${pad()}-${label}.db.json`), JSON.stringify({ sql, rows }, null, 2) + '\n');
  return rows;
}

async function capture(page, label) {
  const base = join(outDir, `${pad()}-${label}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true });
  writeFileSync(`${base}.aria.yml`, await page.locator('body').ariaSnapshot());
}

async function step(label, page, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ label, ok: true, ms: Date.now() - started, url: page.url(), detail });
    await capture(page, label);
    return detail;
  } catch (error) {
    steps.push({ label, ok: false, ms: Date.now() - started, url: page.url(), error: String(error?.message ?? error) });
    await capture(page, `${label}-FAILED`).catch(() => {});
    throw error;
  }
}

async function waitDb(sql, pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = dbq(sql);
    if (pred(rows)) return rows;
    if (Date.now() > deadline) throw new Error(`timed out waiting on DB: ${sql}`);
    await sleep(200);
  }
}

const tileValue = (page, label) =>
  page.getByText(label, { exact: true }).first().locator('xpath=preceding-sibling::div[1]');
const configCard = (page, name) =>
  page.locator('div.rounded-lg.border')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Start Session', exact: true }) });
const clickMe = page => page.getByRole('button', { name: 'Click Me', exact: true }).first();

async function createConfiguration(page, name) {
  await step('open-new-configuration', page, async () => {
    await page.goto(`${ES_WEB}/`);
    await page.getByRole('button', { name: 'New Configuration', exact: true }).click();
    await page.getByRole('heading', { name: 'Create Configuration', exact: true }).waitFor();
  });
  await step('fill-session-settings', page, async () => {
    await page.getByLabel('Configuration Name *').fill(name);
    await page.getByLabel('Time Limit (seconds) *').fill(String(timeLimit));
  });
  await step('save-configuration', page, async () => {
    await page.getByRole('button', { name: 'Create Configuration', exact: true }).click();
    await page.waitForURL(`${ES_WEB}/configurations`);
    await configCard(page, name).waitFor();
  });
  const rows = db('configuration-row', `select configId, name, json_extract(config,'$.timeLimit') timeLimit,
    json_array_length(config,'$.inputs') inputs, json_extract(config,'$.inputs[0].isRewarded') leftRewarded, isArchived
    from configurations where name=${q(name)}`);
  assert(rows.length === 1, `expected one configuration named ${name}, got ${rows.length}`);
  assert(rows[0].timeLimit === timeLimit && rows[0].inputs === 3 && rows[0].leftRewarded === 1 && rows[0].isArchived === 0,
    `stored configuration differs: ${JSON.stringify(rows[0])}`);
  return rows[0].configId;
}

async function ensureConfiguration(page, name) {
  if (dbq(`select 1 from configurations where name=${q(name)}`).length === 0) await createConfiguration(page, name);
}

async function createSession(page, name, pid) {
  await step('open-configurations', page, async () => {
    await page.goto(`${ES_WEB}/`);
    await page.getByRole('link', { name: 'Configurations', exact: true }).click();
    await configCard(page, name).waitFor();
  });
  await step('choose-start-session', page, async () => {
    await configCard(page, name).getByRole('button', { name: 'Start Session', exact: true }).click();
    await page.getByRole('heading', { name: 'Start New Session', exact: true }).waitFor();
  });
  const preview = await step('enter-participant', page, async () => {
    await page.getByLabel('Participant ID *').fill(pid);
    const hint = page.getByText(/^This will be session #\d+ for participant /);
    await hint.waitFor();
    return (await hint.innerText()).trim();
  });
  const n = preview.match(/#(\d+)/)[1];
  const sessionId = await step('create-session', page, async () => {
    await page.getByRole('button', { name: 'Create Session', exact: true }).click();
    await page.getByRole('button', { name: 'Start Session →', exact: true }).waitFor();
    return (await page.locator('code').first().innerText()).trim();
  });
  assert(sessionId === `${pid}-${n}`, `session id ${sessionId} does not match preview ${preview}`);
  const rows = db('session-created', `select sessionId, participantId, startedAt, endedAt from sessions where sessionId=${q(sessionId)}`);
  assert(rows.length === 1 && rows[0].endedAt === null, `session row not created as open: ${JSON.stringify(rows)}`);
  return sessionId;
}

async function runSession(page, sessionId, n) {
  await step('enter-session', page, async () => {
    await page.getByRole('button', { name: 'Start Session →', exact: true }).click();
    await page.waitForURL(`${ES_WEB}/session/${sessionId}`);
    await page.getByText('$0.00 / $10000.00', { exact: true }).waitFor();
    await waitDb(`select 1 from session_event_log where sessionId=${q(sessionId)} and event='start'`, r => r.length === 1, 5000);
  });
  await step('click-rewarded-input', page, async () => {
    for (let i = 0; i < n; i++) await clickMe(page).click();
    await page.getByText(`${earned(n)} / $10000.00`, { exact: true }).waitFor();
    return { clicks: n, balance: earned(n) };
  });
  await step('time-limit-ends-session', page, async () => {
    await page.getByText('Time limit reached. Session ended.', { exact: true }).waitFor({ timeout: (timeLimit + 15) * 1000 });
    assert(await clickMe(page).isDisabled(), 'Click Me still enabled after the time limit');
  });
  const sess = db('session-ended', `select sessionId, startedAt, endedAt from sessions where sessionId=${q(sessionId)}`);
  assert(sess[0]?.endedAt, 'sessions.endedAt not set');
  const ev = db('session-events', `select event, count(*) n from session_event_log where sessionId=${q(sessionId)} group by event order by event`);
  const count = Object.fromEntries(ev.map(r => [r.event, r.n]));
  assert(count.start === 1 && count.end === 1 && count.click === n, `event counts ${JSON.stringify(count)} != start 1, end 1, click ${n}`);
  const end = db('end-event', `select json_extract(value,'$.timeLimitReached') timeLimitReached, json_extract(value,'$.moneyCounter') moneyCounter,
    json_extract(value,'$.totalClicks') totalClicks from session_event_log where sessionId=${q(sessionId)} and event='end'`);
  assert(end[0].timeLimitReached === 1 && money(end[0].moneyCounter) === earned(n) && end[0].totalClicks === n,
    `end event ${JSON.stringify(end[0])}`);
}

const journeys = {
  async configurations(page) {
    const name = opts.name ?? `Verify config ${Date.now()}`;
    const configId = await createConfiguration(page, name);
    return { name, configId };
  },

  async 'session-run'(page) {
    await ensureConfiguration(page, config);
    const sessionId = await createSession(page, config, participant);
    await runSession(page, sessionId, clicks);
    await step('home-lists-session', page, async () => {
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      const row = page.getByRole('row').filter({ hasText: participant });
      await row.getByText('Completed', { exact: true }).waitFor();
      return (await row.innerText()).replace(/\s+/g, ' ');
    });
    return { sessionId, participant, clicks };
  },

  async analytics(page) {
    const sessionId = opts.session;
    assert(sessionId, 'analytics needs --session <sessionId> of an ended session (run session-run first)');
    const end = db('expected-from-db', `select json_extract(value,'$.moneyCounter') moneyCounter, json_extract(value,'$.totalClicks') totalClicks,
      json_extract(value,'$.timeLimitReached') timeLimitReached from session_event_log where sessionId=${q(sessionId)} and event='end'`);
    assert(end.length === 1, `session ${sessionId} has no end event`);
    const tiles = await step('open-session-analytics', page, async () => {
      await page.goto(`${ES_WEB}/analytics/${sessionId}`);
      await page.getByRole('heading', { name: 'Analytics Dashboard', exact: true }).waitFor();
      await page.getByText('End Reason', { exact: true }).waitFor();
      const read = async l => (await tileValue(page, l).innerText()).trim();
      return { endReason: await read('End Reason'), totalClicks: await read('Total Clicks'), moneyEarned: await read('Money Earned') };
    });
    assert(tiles.endReason === (end[0].timeLimitReached ? 'Time Limit' : 'Money Limit'), `End Reason tile ${tiles.endReason}`);
    assert(tiles.totalClicks === String(end[0].totalClicks), `Total Clicks tile ${tiles.totalClicks} != ${end[0].totalClicks}`);
    assert(tiles.moneyEarned === money(end[0].moneyCounter), `Money Earned tile ${tiles.moneyEarned} != ${money(end[0].moneyCounter)}`);
    const note = `verify note ${Date.now()}`;
    const notesBox = page.getByPlaceholder('Add observations, notes, or comments about this session...');
    await step('save-session-notes', page, async () => {
      await notesBox.fill(note);
      await page.getByRole('button', { name: 'Save Notes', exact: true }).click();
      await page.getByText('✓ Saved', { exact: true }).waitFor();
    });
    await step('notes-survive-reload', page, async () => {
      await page.reload();
      await page.waitForFunction(v => document.querySelector('textarea')?.value === v, note);
      return await notesBox.inputValue();
    });
    const notes = db('session-notes', `select notes from session_notes where sessionId=${q(sessionId)}`);
    assert(notes[0]?.notes === note, 'session_notes row does not hold the saved note');
    const exported = await step('export-json', page, async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export JSON', exact: true }).click(),
      ]);
      const file = join(outDir, download.suggestedFilename());
      await download.saveAs(file);
      const data = JSON.parse(readFileSync(file, 'utf8'));
      return { file, sessionId: data.sessionId };
    });
    assert(exported.sessionId === sessionId, `exported JSON sessionId ${exported.sessionId}`);
    return { sessionId, tiles, note, export: exported.file };
  },

  async 'live-monitor'(page, context) {
    await ensureConfiguration(page, config);
    const sessionId = await createSession(page, config, participant);
    const monitor = await context.newPage();
    await step('monitor-connect', monitor, async () => {
      await monitor.goto(`${ES_WEB}/`);
      await monitor.getByRole('link', { name: 'Monitor', exact: true }).click();
      await monitor.getByPlaceholder('e.g. participant1-3').fill(sessionId);
      await monitor.getByRole('button', { name: 'Connect', exact: true }).click();
      await monitor.waitForURL(`${ES_WEB}/monitor/${sessionId}`);
      await monitor.getByText('Live', { exact: true }).waitFor();
    });
    await step('participant-starts', page, async () => {
      await page.getByRole('button', { name: 'Start Session →', exact: true }).click();
      await page.waitForURL(`${ES_WEB}/session/${sessionId}`);
      await page.getByText('$0.00 / $10000.00', { exact: true }).waitFor();
      for (let i = 0; i < clicks; i++) await clickMe(page).click();
    });
    await step('monitor-shows-clicks', monitor, async () => {
      await monitor.waitForFunction(n => {
        const label = [...document.querySelectorAll('div')].find(d => d.textContent === 'Total Clicks');
        return label?.previousElementSibling?.textContent === String(n);
      }, clicks);
      return { totalClicks: (await tileValue(monitor, 'Total Clicks').innerText()).trim() };
    });
    await step('monitor-sees-end', monitor, async () => {
      await monitor.getByText('Session Ended', { exact: true }).waitFor({ timeout: (timeLimit + 15) * 1000 });
      await monitor.getByText('Session has ended. Final data is now available in Analytics.').waitFor();
    });
    const ev = db('session-events', `select event, count(*) n from session_event_log where sessionId=${q(sessionId)} group by event order by event`);
    const count = Object.fromEntries(ev.map(r => [r.event, r.n]));
    assert(count.click === clicks && count.end === 1, `event counts ${JSON.stringify(count)}`);
    return { sessionId, clicks };
  },

  async sequences(page) {
    await ensureConfiguration(page, config);
    const name = opts.name ?? `Verify sequence ${Date.now()}`;
    const configId = dbq(`select configId from configurations where name=${q(config)}`)[0]?.configId;
    await step('create-sequence', page, async () => {
      await page.goto(`${ES_WEB}/`);
      await page.getByRole('link', { name: 'Session Sequences', exact: true }).click();
      await page.getByRole('button', { name: 'Create Sequence', exact: true }).click();
      await page.getByLabel('Sequence name').fill(name);
      for (let i = 0; i < 2; i++) {
        await page.getByLabel('Configuration', { exact: true }).selectOption({ label: config });
        await page.getByRole('button', { name: 'Add Configuration', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Save Sequence', exact: true }).click();
      await page.getByRole('heading', { name, exact: true }).waitFor();
    });
    const seqRows = db('sequence-saved', `select s.sequenceId, s.name, e.position, e.configId from session_sequences s
      join session_sequence_entries e using(sequenceId) where s.name=${q(name)} order by e.position`);
    assert(seqRows.length === 2 && seqRows.every(r => r.configId === configId), `sequence entries ${JSON.stringify(seqRows)}`);
    await step('start-sequence', page, async () => {
      await page.getByRole('button', { name: `Start ${name}`, exact: true }).click();
      await page.getByLabel('Participant ID', { exact: true }).fill(participant);
      await page.getByRole('button', { name: 'Start Sequence', exact: true }).click();
      await page.waitForURL(/\/sequence-run\?runId=/);
      await page.getByLabel('Balance', { exact: true }).waitFor();
    });
    const runId = new URL(page.url()).searchParams.get('runId');
    for (const pos of [0, 1]) {
      await step(`condition-${pos + 1}-clicks`, page, async () => {
        await waitDb(`select currentPosition from sequence_runs where runId=${q(runId)}`, r => r[0]?.currentPosition === pos, (timeLimit + 15) * 1000);
        await page.waitForFunction(() => {
          const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Click Me');
          return b && !b.disabled;
        });
        for (let i = 0; i < clicks; i++) await clickMe(page).click();
        await page.getByLabel('Balance', { exact: true }).filter({ hasText: earned(clicks * (pos + 1)) }).waitFor();
        return { balance: earned(clicks * (pos + 1)) };
      });
    }
    await step('sequence-complete', page, async () => {
      await page.getByText('Session complete.', { exact: true }).waitFor({ timeout: (timeLimit + 15) * 1000 });
      return { balance: (await page.getByLabel('Balance', { exact: true }).innerText()).trim() };
    });
    const run = db('sequence-run', `select runId, status, currentPosition, sequenceBalance, endedAt from sequence_runs where runId=${q(runId)}`);
    assert(run[0]?.status === 'completed' && run[0].currentPosition === 2 && money(run[0].sequenceBalance) === earned(clicks * 2),
      `sequence_runs row ${JSON.stringify(run[0])}`);
    const entries = db('sequence-run-entries', `select e.position, e.sessionId, s.startedAt, s.endedAt from sequence_run_entries e
      join sessions s using(sessionId) where e.runId=${q(runId)} order by e.position`);
    assert(entries.length === 2 && entries.every(e => e.startedAt && e.endedAt), `run entries ${JSON.stringify(entries)}`);
    await step('sequence-runs-history', page, async () => {
      await page.getByRole('link', { name: 'Sequence Runs', exact: true }).click();
      const row = page.getByRole('row').filter({ hasText: participant });
      await row.getByText('Completed', { exact: true }).waitFor();
      return (await row.innerText()).replace(/\s+/g, ' ');
    });
    return { name, runId, participant, balance: money(run[0].sequenceBalance) };
  },
};

if (!journeys[journey]) {
  console.error(`usage: control.sh drive <${Object.keys(journeys).join('|')}> [--key value ...]`);
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
let result;
try {
  result = { journey, ok: true, opts, output: await journeys[journey](page, context) };
} catch (error) {
  result = { journey, ok: false, opts, error: String(error?.message ?? error) };
} finally {
  await browser.close();
}
result.steps = steps;
result.consoleErrors = consoleErrors;
writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`${result.ok ? 'PASS' : 'FAIL'} ${journey} ${JSON.stringify(result.output ?? result.error)} evidence=${outDir}`);
process.exit(result.ok ? 0 : 1);
