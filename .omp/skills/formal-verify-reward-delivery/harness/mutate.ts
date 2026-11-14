// Broken variants of the covered code. `check.sh --mutants` applies each one to a scratch
// copy and requires the check to fail with the named property, so every property is seen
// failing. Run from the scratch copy's root: `bun harness/mutate.ts list | apply <id>`.
import { readFileSync, writeFileSync } from 'node:fs';

interface Mutant {
  id: string;
  property: string;
  file: string;
  find: string;
  replace: string;
}

const SESSION = 'client/src/pages/Session.tsx';
const STORE = 'client/src/stores/useSessionStore.ts';

const MUTANTS: Mutant[] = [
  {
    id: 'uncapped-payout',
    property: 'money-cap',
    file: SESSION,
    find: 'const awardedCents = Math.min(inputConfig.moneyAwarded, Math.max(0, config.moneyLimit - current));',
    replace: 'const awardedCents = inputConfig.moneyAwarded;',
  },
  {
    id: 'double-payout',
    property: 'one-reinforcer-per-response',
    file: SESSION,
    find: 'if (!codEnabled || (codSatisfied && awardedCents === 0)) {',
    replace: 'if (!codEnabled || codSatisfied) {',
  },
  {
    id: 'delay-ignored',
    property: 'changeover-delay',
    file: SESSION,
    find: 'codSatisfied = lastOther === -Infinity || nowMs - lastOther >= codMs;',
    replace: 'codSatisfied = true;',
  },
  {
    id: 'delay-edge-excluded',
    property: 'reinforcer-due-is-paid',
    file: SESSION,
    find: 'codSatisfied = lastOther === -Infinity || nowMs - lastOther >= codMs;',
    replace: 'codSatisfied = lastOther === -Infinity || nowMs - lastOther > codMs;',
  },
  {
    id: 'bank-dropped',
    property: 'banked-conserved',
    file: SESSION,
    find: '          bankReward(inputId);\n          codWithheld = true;',
    replace: '          codWithheld = true;',
  },
  {
    id: 'schedule-restarts',
    property: 'schedule-fidelity',
    file: STORE,
    find: '[inputId]: rewardState.sequence,',
    replace: '[inputId]: [],',
  },
  {
    id: 'limit-ignored',
    property: 'limit-freezes-rewards',
    file: SESSION,
    find: 'if (inputConfig.isRewarded && !useSessionStore.getState().moneyLimitReached) {',
    replace: 'if (inputConfig.isRewarded) {',
  },
  {
    id: 'stale-logged-money',
    property: 'click-log-truth',
    file: SESSION,
    find: '        awardedCents,\n        moneyCounter: latest.moneyCounter,',
    replace: '        awardedCents,\n        moneyCounter,',
  },
  {
    id: 'unrewarded-click-unlogged',
    property: 'every-response-is-recorded',
    file: SESSION,
    find: "    void logSessionEvent(runtime, {\n      event: 'click',",
    replace: "    if (awardedCents > 0) void logSessionEvent(runtime, {\n      event: 'click',",
  },
  {
    id: 'limit-never-ends',
    property: 'money-limit-ending',
    file: SESSION,
    find: "    if (latest.moneyLimitReached && !config.continueAfterMoneyLimit) {\n      void finishSession('money');\n    }",
    replace: '',
  },
  {
    id: 'limit-flag-leaks',
    property: 'session-reset',
    file: STORE,
    find: '      pendingRewards,\n      moneyLimitReached: false,\n      timeLimitReached: false,\n      sessionActive: false,\n    });',
    replace: '      pendingRewards,\n      timeLimitReached: false,\n      sessionActive: false,\n    });',
  },
  {
    id: 'debounce-removed',
    property: 'ignored-response-changes-nothing',
    file: 'client/src/lib/useExternalInput.ts',
    find: '      if (now - last < debounceMs) return false;\n',
    replace: '',
  },
  {
    id: 'cycle-off-by-one',
    property: 'variable-schedule-average',
    file: 'client/src/lib/rewardSchedules.ts',
    find: 'const targetTotal = averageInterval * count;',
    replace: 'const targetTotal = averageInterval * count + 1;',
  },
];

const [command, id] = process.argv.slice(2);
if (command === 'list') {
  for (const mutant of MUTANTS) console.log(`${mutant.id}\t${mutant.property}\t${mutant.file}`);
} else if (command === 'apply') {
  const mutant = MUTANTS.find(candidate => candidate.id === id);
  if (!mutant) {
    console.error(`unknown broken variant: ${id}`);
    process.exit(3);
  }
  const source = readFileSync(mutant.file, 'utf8');
  const occurrences = source.split(mutant.find).length - 1;
  if (occurrences !== 1) {
    console.error(`${mutant.id}: expected exactly one match in ${mutant.file}, found ${occurrences}. ` +
      'The covered code changed; update this broken variant to the new text before trusting the check.');
    process.exit(3);
  }
  writeFileSync(mutant.file, source.replace(mutant.find, () => mutant.replace));
} else {
  console.error('usage: bun harness/mutate.ts list | apply <id>');
  process.exit(3);
}
