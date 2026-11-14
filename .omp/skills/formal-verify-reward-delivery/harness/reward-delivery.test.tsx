// Generated-input check of reward delivery. It mounts the real participant runner
// (client/src/pages/Session.tsx) with the real Zustand store and API client, presses
// generated inputs at generated times, and compares every response with the contract
// written in AGENTS.md ("Changeover delay", "Reward schedule behavior", "State Reset
// Across Sessions"). Only fetch, Audio, the clock and Math.random are replaced.
import { expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Session } from '../client/src/pages/Session';
import { useSessionStore } from '../client/src/stores/useSessionStore';
import type { BaseConfig, InputConfig } from '../client/src/types';

const SEED = Number(process.env.REWARD_VERIFY_SEED ?? Date.now() % 2_147_483_647);
const RUNS = Number(process.env.REWARD_VERIFY_RUNS ?? 1000);
const COLLECT = process.env.REWARD_VERIFY_COLLECT === '1';
// '1': run only the scenarios of the findings recorded in SKILL.md, without excusing them.
const FINDINGS = process.env.REWARD_VERIFY_FINDINGS === '1';
// Finding F1 (SKILL.md "Known findings") is open: on its trigger the code is known to break
// the contract. The generated scenarios count the trigger and take that one response as the
// code left it, so everything after it is still checked. Set to false once F1 is fixed;
// check.sh reads this line to decide whether to run the finding's own scenario.
const F1_OPEN = true;

const T0 = Date.UTC(2026, 0, 1);
const DEBOUNCE_MS = 50; // useExternalInput's default debounceMs, applied to keyboard inputs only
const TIME_LIMIT_SECONDS = 30; // never elapses inside a scenario; also the variable-schedule cycle length
const KEY_CODES = ['KeyQ', 'KeyW', 'KeyE'];

interface Step {
  input: number;
  gap: number;
  // true: gap is an offset from changeoverDelayMs, so -1/0/+1 land on the window edge
  fromDelay: boolean;
}

interface Scenario {
  config: BaseConfig;
  steps: Step[];
  rngSeed: number;
}

interface RecordedRequest {
  path: string;
  body: { event?: string; value: Record<string, unknown>; timestamp?: string };
}

const scheduleArb = fc.oneof(
  fc.record({ awardInterval: fc.integer({ min: 1, max: 4 }) }),
  fc.record({ rewardSchedule: fc.constant('fixed' as const), awardInterval: fc.integer({ min: 1, max: 4 }) }),
  fc.record({
    rewardSchedule: fc.constant('custom' as const),
    awardInterval: fc.integer({ min: 1, max: 4 }),
    rewardIntervals: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 4 }),
  }),
  fc.record({ rewardSchedule: fc.constant('variable' as const), awardInterval: fc.integer({ min: 1, max: 4 }) }),
);

function inputArb(index: number): fc.Arbitrary<InputConfig> {
  return fc.record({
    type: fc.constantFrom('screen' as const, 'keyboard' as const),
    isRewarded: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
    // Zero-cent reinforcers (sound only) are valid: the server schema accepts moneyAwarded 0.
    moneyAwarded: fc.oneof({ weight: 9, arbitrary: fc.integer({ min: 1, max: 12 }) }, { weight: 1, arbitrary: fc.constant(0) }),
    playAwardSound: fc.boolean(),
    schedule: scheduleArb,
  }).map(({ schedule, ...rest }) => ({
    id: `in${index}`,
    name: `Input ${index}`,
    shape: 'circle' as const,
    color: '#336699',
    inputCode: KEY_CODES[index],
    inputLabel: KEY_CODES[index],
    ...rest,
    ...schedule,
  }));
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  inputs: fc.tuple(inputArb(0), inputArb(1), fc.option(inputArb(2), { nil: undefined })),
  changeoverDelayEnabled: fc.boolean(),
  changeoverDelayMs: fc.constantFrom(60, 250, 1000),
  moneyLimit: fc.integer({ min: 1, max: 120 }),
  startingMoney: fc.integer({ min: 0, max: 130 }),
  // The schema also accepts a starting balance at or above the limit; reach it sometimes.
  startsAtLimit: fc.oneof({ weight: 9, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
  continueAfterMoneyLimit: fc.boolean(),
  steps: fc.array(
    fc.oneof(
      fc.record({ input: fc.nat(2), gap: fc.constantFrom(-1, 0, 1), fromDelay: fc.constant(true) }),
      fc.record({ input: fc.nat(2), gap: fc.constantFrom(0, 1, 49, 50), fromDelay: fc.constant(false) }),
      fc.record({ input: fc.nat(2), gap: fc.integer({ min: 0, max: 2500 }), fromDelay: fc.constant(false) }),
    ),
    { minLength: 1, maxLength: 40 },
  ),
  rngSeed: fc.integer(),
}).map(({ inputs, steps, rngSeed, startingMoney, startsAtLimit, ...rest }) => {
  const present = inputs.filter(input => input !== undefined);
  return {
    config: {
      timeLimit: TIME_LIMIT_SECONDS,
      ...rest,
      startingMoney: startsAtLimit ? rest.moneyLimit + (startingMoney % 11) : startingMoney % rest.moneyLimit,
      inputs: present,
      pauseEnabled: false,
    },
    steps: steps.map(step => ({ ...step, input: step.input % present.length })),
    rngSeed,
  };
});

// mulberry32: makes the product's Math.random (variable schedules) replayable from the seed.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

async function nextMacrotask(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

let plays = 0;
class CountingAudio {
  currentTime = 0;
  play(): Promise<void> {
    plays += 1;
    return Promise.resolve();
  }
  pause(): void {}
}
Object.assign(globalThis, { Audio: CountingAudio });

function describeInput(input: InputConfig): string {
  const schedule = input.rewardSchedule === 'custom'
    ? `custom [${input.rewardIntervals?.join(', ')}]`
    : `${input.rewardSchedule ?? 'fixed (default)'} every ${input.awardInterval}`;
  const reward = input.isRewarded
    ? `rewarded ${input.moneyAwarded}c, ${schedule}, sound ${input.playAwardSound ? 'on' : 'off'}`
    : 'not rewarded';
  return `  ${input.id}: ${input.type}${input.type === 'keyboard' ? ` ${input.inputCode}` : ''}, ${reward}`;
}

let sessionNumber = 0;
// What the generated scenarios actually reached; printed so a pass is never vacuous.
const reached = {
  responses: 0, ignored: 0, paid: 0, clamped: 0, withheld: 0, bankedPaid: 0,
  overlap: 0, insideDelay: 0, afterLimit: 0, limitEndings: 0,
};
let f1Excused = 0;

async function runScenario({ config, steps, rngSeed }: Scenario, excuseOpenFindings = F1_OPEN): Promise<void> {
  sessionNumber += 1;
  const sessionId = `VERIFY-${sessionNumber}`;
  const codEnabled = config.changeoverDelayEnabled === true;
  const codMs = config.changeoverDelayMs ?? 1000;
  const transcript = [
    `session ${sessionId}: moneyLimit ${config.moneyLimit}c, startingMoney ${config.startingMoney}c, ` +
      `changeover delay ${codEnabled ? `${codMs}ms` : 'off'}, continueAfterMoneyLimit ${config.continueAfterMoneyLimit}`,
    ...config.inputs.map(describeInput),
  ];
  // Set on a response that matches the trigger of a finding already recorded in SKILL.md.
  let knownFinding = '';
  const fail = (property: string, detail: string): never => {
    throw new Error(`[${property}]${knownFinding} ${detail}\n${transcript.join('\n')}`);
  };

  const requests: RecordedRequest[] = [];
  const stray: string[] = [];
  const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api/, '');
    if (path === `/sessions/${sessionId}/data`) {
      return { ok: true, statusText: 'OK', json: async () => ({
        sessionConfig: config, startEvent: null, endEvent: null, allClicks: [], pauseEvents: [],
      }) };
    }
    if (init?.method === 'POST' && (path === '/events' || path === `/sessions/${sessionId}/end`)) {
      const body = JSON.parse(String(init.body));
      if (path === '/events' && body.sessionId !== sessionId) stray.push(`${path} for ${body.sessionId}`);
      else requests.push({ path, body });
      return { ok: true, statusText: 'OK', json: async () => ({ message: 'saved' }) };
    }
    stray.push(`${init?.method ?? 'GET'} ${path}`);
    return { ok: false, statusText: 'Unexpected request', json: async () => ({ error: 'Unexpected request' }) };
  };
  // ApiClient.request reads only ok, statusText and json() from the response.
  globalThis.fetch = fetchStub as unknown as typeof fetch;

  const realRandom = Math.random;
  Math.random = seededRandom(rngSeed);
  let now = T0;
  setSystemTime(new Date(now));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    root.render(
      <MemoryRouter initialEntries={[`/session/${sessionId}`]}>
        <Routes><Route path="/session/:sessionId" element={<Session />} /></Routes>
      </MemoryRouter>,
    );
    for (let waited = 0; waited < 500 && !useSessionStore.getState().sessionActive; waited += 1) await nextMacrotask();
    await nextMacrotask();
    const started = useSessionStore.getState();
    if (!started.sessionActive || started.config?.sessionId !== sessionId) {
      fail('harness', `the runner never became active (${container.textContent})`);
    }

    // State Reset Across Sessions: nothing from the previous scenario may survive setConfig.
    const startBody = requests[0]?.body;
    const cleanStart = started.moneyCounter === config.startingMoney && !started.moneyLimitReached &&
      !started.timeLimitReached && started.totalClicks === 0 &&
      config.inputs.every(input => started.pendingRewards[input.id] === 0 &&
        started.inputIntervalCounters[input.id] === 0 && started.inputClickCounts[input.id] === 0) &&
      requests.length === 1 && startBody?.event === 'start' && Bun.deepEquals(startBody.value, {
        moneyCounter: config.startingMoney, moneyLimitReached: false, timeLimitReached: false,
      }, true);
    if (!cleanStart) {
      fail('session-reset', `the session did not start clean: money ${started.moneyCounter}c, ` +
        `moneyLimitReached ${started.moneyLimitReached}, pendingRewards ${JSON.stringify(started.pendingRewards)}, ` +
        `first write ${JSON.stringify(startBody)}`);
    }

    // The contract's own bookkeeping, kept apart from the store.
    let money = config.startingMoney;
    let limitReached = false;
    let ended = false;
    let total = 0;
    const counts: Record<string, number> = {};
    const sinceReward: Record<string, number> = {};
    const earnedCount: Record<string, number> = {};
    const banked: Record<string, number> = {};
    const lastAt: Record<string, number> = {};
    const lastKeyAt: Record<string, number> = {};
    for (const input of config.inputs) {
      counts[input.id] = 0;
      sinceReward[input.id] = 0;
      earnedCount[input.id] = 0;
      banked[input.id] = 0;
    }

    for (const step of steps) {
      knownFinding = '';
      const input = config.inputs[step.input];
      const { id } = input;
      now += step.fromDelay ? codMs + step.gap : step.gap;
      setSystemTime(new Date(now));

      const before = useSessionStore.getState();
      const targetBefore = before.inputRewardTargets[id];
      const requestsBefore = requests.length;
      const playsBefore = plays;

      if (input.type === 'screen') {
        const screenIndex = config.inputs.filter(candidate => candidate.type === 'screen').indexOf(input);
        const button = container.querySelectorAll('button')[screenIndex];
        if (!button) fail('harness', `no screen button rendered for ${id}`);
        button.click();
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: input.inputCode, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: input.inputCode, bubbles: true }));
      }
      await nextMacrotask();
      await nextMacrotask();

      const after = useSessionStore.getState();
      const moneyDelta = after.moneyCounter - before.moneyCounter;
      const playsDelta = plays - playsBefore;
      const written = requests.slice(requestsBefore);
      if (stray.length > 0) fail('harness', `unexpected request ${stray.join('; ')}`);

      const debounced = input.type === 'keyboard' && lastKeyAt[id] !== undefined && now - lastKeyAt[id] < DEBOUNCE_MS;
      if (ended || debounced) {
        reached.ignored += 1;
        transcript.push(`t+${now - T0}ms press ${id}: ${ended ? 'session already ended' : 'inside the 50ms key debounce'}, must be ignored`);
        if (written.length > 0 || moneyDelta !== 0 || playsDelta !== 0 || after.totalClicks !== before.totalClicks ||
          !Bun.deepEquals(after.pendingRewards, before.pendingRewards, true)) {
          fail('ignored-response-changes-nothing', `an ignored press changed state: ${written.length} write(s), ` +
            `money ${moneyDelta >= 0 ? '+' : ''}${moneyDelta}c, ${playsDelta} sound(s), totalClicks ${before.totalClicks} -> ${after.totalClicks}`);
        }
        continue;
      }
      if (input.type === 'keyboard') lastKeyAt[id] = now;

      const windowOpen = codEnabled && config.inputs.some(other =>
        other.id !== id && lastAt[other.id] !== undefined && now - lastAt[other.id] < codMs);
      const frozen = !input.isRewarded || limitReached;
      const limitReachedBefore = limitReached;
      const room = Math.max(0, config.moneyLimit - money);
      lastAt[id] = now;
      counts[id] += 1;
      total += 1;

      // Fixed and custom schedules are predicted from the config alone. A variable schedule is
      // random, so its target is read from the store; the cycle test below checks its average.
      const custom = input.rewardSchedule === 'custom' ? input.rewardIntervals : undefined;
      const scheduledTarget = input.rewardSchedule === 'variable'
        ? undefined
        : custom ? custom[earnedCount[id] % custom.length] : input.awardInterval;
      let due = false;
      let withheld = false;
      if (!frozen) {
        sinceReward[id] += 1;
        const earned = sinceReward[id] >= (scheduledTarget ?? targetBefore);
        if (earned) {
          sinceReward[id] = 0;
          earnedCount[id] += 1;
        }
        if (!codEnabled) {
          due = earned;
        } else if (windowOpen) {
          withheld = earned;
        } else if (banked[id] > 0) {
          // The banked reinforcer pays; one earned on the same response stays banked.
          due = true;
          banked[id] -= 1;
          withheld = earned;
          reached.bankedPaid += 1;
          if (earned) reached.overlap += 1;
        } else {
          due = earned;
        }
        if (withheld) banked[id] += 1;
      }
      const paid = due ? Math.min(input.moneyAwarded, room) : 0;
      money += paid;
      if (due && money >= config.moneyLimit) limitReached = true;
      // F1: a banked reinforcer worth 0 cents pays while the same response earns another one.
      knownFinding = due && withheld && paid === 0 ? ' [known finding F1: zero-cent overlap]' : '';
      if (knownFinding && excuseOpenFindings) {
        // The code pays both reinforcers on this response and banks none; follow it and go on.
        f1Excused += 1;
        banked[id] -= 1;
        if (limitReached && !config.continueAfterMoneyLimit) ended = true;
        transcript.push(`t+${now - T0}ms press ${id}: trigger of known finding F1, taken as the code left it`);
        continue;
      }
      reached.responses += 1;
      if (due) reached.paid += 1;
      if (due && paid < input.moneyAwarded) reached.clamped += 1;
      if (withheld) reached.withheld += 1;
      if (windowOpen) reached.insideDelay += 1;
      if (limitReachedBefore) reached.afterLimit += 1;

      const click = written[0]?.body;
      transcript.push(`t+${now - T0}ms press ${id}` +
        `${windowOpen ? ' (another input pressed inside the delay)' : ''}: awarded ${moneyDelta}c, money ${after.moneyCounter}c, ` +
        `banked ${JSON.stringify(after.pendingRewards)}, sounds ${playsDelta}, logged ${JSON.stringify(click?.value)}`);

      // Every property is evaluated on every response, so one report names all that broke.
      const broken: string[] = [];
      const breaks = (property: string, detail: string): void => {
        broken.push(`[${property}]${knownFinding} ${detail}`);
      };
      const eventWrites = written.filter(request => request.path === '/events');
      if (eventWrites.length !== 1 || written[0] !== eventWrites[0] || click?.event !== 'click') {
        breaks('every-response-is-recorded', `an accepted press must write exactly one click event, wrote ${JSON.stringify(written)}`);
      }
      if (!frozen && (scheduledTarget === undefined
        ? !Number.isInteger(targetBefore) || targetBefore < 1
        : targetBefore !== scheduledTarget)) {
        breaks('schedule-fidelity', `${id} needed ${targetBefore} responses for its next reinforcer, ` +
          `the configured schedule says ${scheduledTarget ?? 'a whole number >= 1'}`);
      }
      if (windowOpen && (moneyDelta !== 0 || playsDelta !== 0)) {
        breaks('changeover-delay', `${id} paid ${moneyDelta}c and played ${playsDelta} sound(s) less than ${codMs}ms after another input was pressed`);
      }
      if (moneyDelta < 0 || after.moneyCounter > Math.max(config.moneyLimit, config.startingMoney)) {
        breaks('money-cap', `money went ${before.moneyCounter}c -> ${after.moneyCounter}c against a limit of ${config.moneyLimit}c`);
      }
      if (limitReachedBefore && (moneyDelta !== 0 || playsDelta !== 0 ||
        !Bun.deepEquals(after.pendingRewards, before.pendingRewards, true) ||
        !Bun.deepEquals(after.inputIntervalCounters, before.inputIntervalCounters, true))) {
        breaks('limit-freezes-rewards', `after the money limit ${id} still paid ${moneyDelta}c, played ${playsDelta} sound(s), ` +
          `moved pendingRewards ${JSON.stringify(before.pendingRewards)} -> ${JSON.stringify(after.pendingRewards)}, ` +
          `or advanced its schedule ${JSON.stringify(before.inputIntervalCounters)} -> ${JSON.stringify(after.inputIntervalCounters)}`);
      }
      if (moneyDelta > input.moneyAwarded || playsDelta > 1) {
        breaks('one-reinforcer-per-response', `one press of ${id} paid ${moneyDelta}c with ${playsDelta} sound(s); ` +
          `a single reinforcer is ${input.moneyAwarded}c and one sound`);
      }
      if (moneyDelta !== paid || playsDelta !== (due && input.playAwardSound ? 1 : 0)) {
        breaks('reinforcer-due-is-paid', `${id} paid ${moneyDelta}c with ${playsDelta} sound(s); the contract says ` +
          `${due ? `one reinforcer of ${paid}c is due` : 'nothing is due'} on this response`);
      }
      if (config.inputs.some(candidate => after.pendingRewards[candidate.id] !== banked[candidate.id])) {
        breaks('banked-conserved', `pendingRewards is ${JSON.stringify(after.pendingRewards)}, the contract says ${JSON.stringify(banked)}`);
      }
      const truthfulLog = {
        inputId: id,
        inputName: input.name,
        inputType: input.type,
        clicks: counts,
        totalClicks: total,
        awardedCents: moneyDelta,
        moneyCounter: after.moneyCounter,
        moneyLimitReached: after.moneyLimitReached,
        timeLimitReached: false,
        codWithheld: withheld,
        codPending: after.pendingRewards[id],
      };
      if (!Bun.deepEquals(click?.value, truthfulLog, true) || click?.timestamp !== new Date(now).toISOString()) {
        breaks('click-log-truth', `the click event does not match what happened; a truthful event is ${JSON.stringify(truthfulLog)} at ${new Date(now).toISOString()}`);
      }

      const ends = requests.filter(request => request.path.endsWith('/end'));
      if (limitReached && !config.continueAfterMoneyLimit) {
        ended = true;
        reached.limitEndings += 1;
        const snapshot = {
          moneyCounter: money, moneyLimitReached: true, timeLimitReached: false,
          clicks: counts, totalClicks: total, pendingRewards: banked,
        };
        if (!after.moneyLimitReached || after.sessionActive || ends.length !== 1 || requests.at(-1) !== ends[0] ||
          !Bun.deepEquals(ends[0].body.value, snapshot, true)) {
          breaks('money-limit-ending', `the session must stop and send one final snapshot ${JSON.stringify(snapshot)} after its last click; ` +
            `moneyLimitReached ${after.moneyLimitReached}, sessionActive ${after.sessionActive}, ` +
            `end requests ${JSON.stringify(ends.map(end => end.body.value))}`);
        }
      } else if (after.moneyLimitReached !== limitReached || !after.sessionActive || ends.length > 0) {
        breaks('money-limit-ending', `the session must stay open with moneyLimitReached ${limitReached}: ` +
          `moneyLimitReached ${after.moneyLimitReached}, sessionActive ${after.sessionActive}, ${ends.length} end request(s)`);
      }
      if (broken.length > 0) throw new Error(`${broken.join('\n')}\n${transcript.join('\n')}`);
    }
  } finally {
    root.unmount();
    container.remove();
    await nextMacrotask();
    Math.random = realRandom;
    setSystemTime();
  }
}

// fast-check wraps the failing scenario's error. Print the scenario's own text first, so every
// [property] line starts a line of output, then fail with the shrunk counterexample.
function reportFailure(failure: unknown): never {
  const cause = failure instanceof Error && failure.cause instanceof Error ? failure.cause : failure;
  console.log(`reward-delivery: property broken\n${cause instanceof Error ? cause.message : String(cause)}`);
  throw failure;
}

// The scenario of finding F1: in0 is a sound-only reinforcer (0 cents) earned on every
// response. Its first press falls inside the changeover delay and is banked; its second press
// is clear, so the banked reinforcer pays and the newly earned one must stay banked.
const F1_SCENARIO: Scenario = {
  config: {
    timeLimit: TIME_LIMIT_SECONDS, moneyLimit: 100, startingMoney: 0, continueAfterMoneyLimit: true,
    changeoverDelayEnabled: true, changeoverDelayMs: 60, pauseEnabled: false,
    inputs: [
      {
        id: 'in0', name: 'Input 0', type: 'screen', shape: 'circle', color: '#336699',
        isRewarded: true, moneyAwarded: 0, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: true,
      },
      {
        id: 'in1', name: 'Input 1', type: 'screen', shape: 'circle', color: '#336699',
        isRewarded: false, moneyAwarded: 0, awardInterval: 1, rewardSchedule: 'fixed', playAwardSound: false,
      },
    ],
  },
  steps: [
    { input: 1, gap: 0, fromDelay: false },
    { input: 0, gap: -1, fromDelay: true },
    { input: 0, gap: 0, fromDelay: true },
  ],
  rngSeed: 0,
};

test.skipIf(FINDINGS)('variable schedule: one generated cycle averages exactly to awardInterval', () => {
  const realRandom = Math.random;
  try {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 120 }), fc.integer(),
      (awardInterval, timeLimit, rngSeed) => {
        Math.random = seededRandom(rngSeed);
        const store = useSessionStore.getState();
        store.setConfig({
          sessionId: 'VERIFY-variable', configId: '', timeLimit, moneyLimit: 1_000_000, startingMoney: 0,
          continueAfterMoneyLimit: true,
          inputs: [{
            id: 'v', name: 'Variable', type: 'screen', isRewarded: true, moneyAwarded: 1,
            awardInterval, rewardSchedule: 'variable', playAwardSound: false,
          }],
        });
        const targets: number[] = [];
        for (let reward = 0; reward < timeLimit; reward += 1) {
          targets.push(store.getRewardTarget('v'));
          store.resetInterval('v');
        }
        const sum = targets.reduce((acc, target) => acc + target, 0);
        if (targets.some(target => !Number.isInteger(target) || target < 1) || sum !== awardInterval * timeLimit) {
          throw new Error(`[variable-schedule-average] awardInterval ${awardInterval} over a ${timeLimit}-reward cycle ` +
            `gave targets [${targets.join(', ')}] summing to ${sum}, expected ${awardInterval * timeLimit} with every target a whole number >= 1`);
        }
      },
    ), { seed: SEED, numRuns: RUNS });
  } catch (failure) {
    reportFailure(failure);
  } finally {
    Math.random = realRandom;
  }
}, 120_000);

test.skipIf(FINDINGS)('reward delivery matches the documented contract', async () => {
  console.log(`reward-delivery: seed=${SEED} runs=${RUNS}${COLLECT ? ' collect=on' : ''}`);
  if (COLLECT) {
    // Broken-variant proof: keep going after a failure and tally every property that broke.
    const brokenProperties: Record<string, number> = {};
    await fc.assert(fc.asyncProperty(scenarioArb, async scenario => {
      try {
        await runScenario(scenario);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        for (const [, property] of message.matchAll(/^\[([a-z-]+)\]/gm)) {
          brokenProperties[property] = (brokenProperties[property] ?? 0) + 1;
        }
      }
    }), { seed: SEED, numRuns: RUNS });
    console.log(`reward-delivery: broken properties ${JSON.stringify(brokenProperties)}`);
    expect(brokenProperties).toEqual({});
    return;
  }
  // The F1 scenario always runs first: excused while F1 is open, a regression check once fixed.
  await fc.assert(fc.asyncProperty(scenarioArb, scenario => runScenario(scenario)), {
    seed: SEED, numRuns: RUNS, examples: [[F1_SCENARIO]],
  }).catch(reportFailure);
  console.log(`reward-delivery: reached ${JSON.stringify(reached)} in ${sessionNumber} sessions, ` +
    `F1 triggers excused ${f1Excused}`);
  const unreached = Object.entries(reached).filter(([, count]) => count === 0).map(([name]) => name);
  if (RUNS >= 300 && unreached.length > 0) {
    throw new Error(`[harness] the generated scenarios never reached: ${unreached.join(', ')}; the pass would be vacuous`);
  }
  expect(sessionNumber).toBeGreaterThanOrEqual(RUNS);
}, 600_000);

test.if(FINDINGS)('finding F1: a zero-cent banked reinforcer and a newly earned one both pay on one response', async () => {
  await runScenario(F1_SCENARIO, false).catch(reportFailure);
});
