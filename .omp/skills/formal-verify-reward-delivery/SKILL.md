---
name: formal-verify-reward-delivery
description: Checks reward delivery in the participant runner against its documented contract by running generated sessions on the real code. Use when a change touches response handling in Session.tsx, useSessionStore, rewardSchedules, useExternalInput, or how payouts, the money limit, reward schedules, the changeover delay, banked rewards or click events behave.
---

# Verify reward delivery

**Property.** Every participant response pays exactly the reinforcers that the configured reward schedule, changeover delay and money limit call for, and the click event saved for that response records exactly what happened.

**Harm when it breaks.** A participant is paid the wrong amount or reinforced at the wrong moment, and the session record that researchers analyze no longer describes the session. Nothing errors, so nobody notices.

The contract is the text in `AGENTS.md` under "Changeover delay fields", "Reward schedule behavior" and "State Reset Across Sessions". The check mounts the real runner (`client/src/pages/Session.tsx` with the real store and API client), presses generated inputs at generated times, and compares each response with that contract.

## Run the check

1. Run `source ~/.config/zsh/agent-env.zsh` so `bun` is on the path.
2. From the repo root run `.omp/skills/formal-verify-reward-delivery/check.sh`. It copies `client/src` from your working tree, uncommitted edits included, to the XDG state directory and runs there. It takes about three seconds and writes nothing in the repo.
3. Read the output top to bottom:
   - `drift` says whether the covered files still match the sync commit. If they differ and the difference is not your own change, read "Coverage record" before you trust a pass.
   - `contract : PASS` means no property broke in the generated sessions. `reached {...}` counts what those sessions exercised.
   - `finding` reports the open finding F1 (below). "still reproduces" is the expected state.
   - `RESULT: PASS` with exit code 0 means your change broke nothing that this check covers.
4. On `RESULT: FAIL`, go to "Read a failure". Rerun the same sessions with `check.sh --seed N`, using the seed printed on the `contract` line.

`check.sh --help` lists the other modes. `check.sh --mutants` applies thirteen broken variants of the covered code, one at a time, and requires each to fail with its property (under half a minute). Run it after you edit the harness.

## Read a failure

A failure prints one line per broken property, then the session as a list of presses in the runner's own words: the input pressed, the cents awarded, `pendingRewards`, and the click event that was logged. The last press listed is the one that broke.

| Line starts with | The promise in plain words | Code it guards |
| --- | --- | --- |
| `[money-cap]` | The money counter never goes down and never passes `moneyLimit`. | `deliverReward` |
| `[one-reinforcer-per-response]` | One response pays at most one reinforcer: at most `moneyAwarded` cents and one award sound. | `handleInputActivation` |
| `[changeover-delay]` | A response made less than `changeoverDelayMs` after a press on another input pays nothing. | `handleInputActivation`, `lastActivationAtRef` |
| `[reinforcer-due-is-paid]` | When the delay is clear and a reinforcer is banked or just earned, exactly one is paid, at the clamped amount. | `handleInputActivation`, `deliverReward` |
| `[banked-conserved]` | A reinforcer earned inside the delay is banked in `pendingRewards` for that input, and leaves only when that input pays it. None is lost, invented or paid through another input. | `bankReward`, `consumePendingReward` |
| `[schedule-fidelity]` | A fixed schedule needs exactly `awardInterval` responses; a custom schedule walks `rewardIntervals` in order and repeats. | `getRewardTarget`, `resetInterval`, `getNextRewardTarget` |
| `[variable-schedule-average]` | One generated cycle of a variable schedule sums to `awardInterval` times its length, with every interval a whole number of at least 1. | `generateRewardIntervals`, `resetInterval` |
| `[limit-freezes-rewards]` | After the money limit is reached, no response pays, plays the award sound, changes `pendingRewards` or advances a schedule. | `handleInputActivation` |
| `[money-limit-ending]` | `moneyLimitReached` turns true exactly when a payout reaches the limit. Without `continueAfterMoneyLimit` the session then stops and sends one final snapshot after its last click; with it the session stays open. | `deliverReward`, `finishSession` |
| `[click-log-truth]` | The click event carries the true counts, cents awarded, money counter, `codWithheld` and `codPending` for that response. | the `logSessionEvent` call in `handleInputActivation` |
| `[every-response-is-recorded]` | Each accepted response writes exactly one click event. | `handleInputActivation`, `logSessionEvent` |
| `[ignored-response-changes-nothing]` | A press after the session ended, or a key press inside the 50 ms debounce, changes no state and writes nothing. | `handleInputActivation` guards, `canTrigger` |
| `[session-reset]` | A new session starts at `startingMoney` with no flags, counters or banked reinforcers left from the previous one. | `setConfig`, `activateCondition` |

Decide what a failure means before you change anything:

- **A real bug.** `AGENTS.md` still describes the behavior the check expects, and your change made the runner do something else. Fix the code. This is the usual case.
- **An intended change.** You changed the rule on purpose and `AGENTS.md` says so. Follow "When a change is intended".
- **A harness error.** The line starts with `[harness]`, or the run fails with no `[property]` line at all (an import error, "the runner never became active", "unexpected request", "no screen button rendered"). The harness no longer fits the runner's route, DOM or API calls. Fix `harness/reward-delivery.test.tsx`, not the product code. The parts that depend on the runner's shape are the `fetchStub` paths, the `<Route path="/session/:sessionId">` mount and the `querySelectorAll('button')` lookup.
- **A setup error.** `check.sh` exits with code 3 and says what is missing.

## Known findings

**F1: a zero-cent banked reinforcer and a newly earned one both pay on one response.** Open at the sync commit. The product code was left as it is.

- Trigger: the changeover delay is on, an input has a banked reinforcer whose payout is 0 cents (`moneyAwarded: 0`, or the money counter already at or above `moneyLimit`), and the response that pays it also completes the schedule.
- What the code does: `handleInputActivation` treats `awardedCents === 0` as "nothing paid on this response yet" (`Session.tsx` line 524), so it delivers the newly earned reinforcer too and banks nothing.
- The smallest session: changeover delay 60 ms; `in0` rewarded with 0 cents and the award sound on every response; `in1` not rewarded. Press `in1`. Press `in0` 59 ms later: the reinforcer is banked, `codPending` is 1. Press `in0` 60 ms later: the award sound plays twice, `pendingRewards.in0` is 0 where the contract says 1, and the click event says `codWithheld: false`.
- Harm: with a sound-only reinforcer the participant loses one delivery per overlap, and the banked count in the telemetry is one short. No cents are mispaid, because both payouts are 0.
- How the check treats it: `F1_OPEN = true` in the harness makes the generated sessions count the trigger (`F1 triggers excused N`) and carry on from the state the code left. The finding's own scenario, `F1_SCENARIO`, runs unexcused on every check and must keep failing with `[known finding F1: zero-cent overlap]`.

### When a finding is fixed

`check.sh` prints `F1 no longer reproduces`. Set `F1_OPEN = false` in `harness/reward-delivery.test.tsx` and run `check.sh` again. The generated sessions now check the trigger, and `F1_SCENARIO` runs first as a regression case. When `contract : PASS` and `finding : none open` both show, replace the F1 entry above with one line that names the fixing commit.

## When a change is intended

1. Change the rule in the product code and in `AGENTS.md`.
2. Restate the new rule in the harness block that starts with the comment "The contract's own bookkeeping" in `harness/reward-delivery.test.tsx`. Write it from the `AGENTS.md` text. Copying the product code into the harness would make the check agree with any bug.
3. Run `check.sh --mutants`. Exit code 3 names each broken variant in `harness/mutate.ts` whose `find` text no longer matches the code; update that text. Add a broken variant for each new rule, with the property that must catch it.
4. Finish when `check.sh` and `check.sh --mutants` both end with `RESULT: PASS`. Then update the coverage record and move the sync commit.

## Coverage record

- Sync commit: `b71a136d43969063710802974d486d8d6a6529ee`

Move the sync commit forward only after you have read `check.sh --drift` and confirmed that every row below still describes the code at the new commit, and both `check.sh` and `check.sh --mutants` pass there. `check.sh` reads the commit from the line above, and its `COVERED` list must name the same files as this table.

| File | Functions the check runs | Why it is covered |
| --- | --- | --- |
| `client/src/pages/Session.tsx` | `handleInputActivation`, `deliverReward`, `finishSession` (money-limit path), `activateCondition`, `logSessionEvent` | The reward decision for each response, the payout clamp, the click event, the money-limit ending |
| `client/src/stores/useSessionStore.ts` | `setConfig`, `incrementClick`, `incrementInterval`, `getRewardTarget`, `resetInterval`, `bankReward`, `consumePendingReward`, `awardMoney`, `setMoneyLimitReached`, `startSession`, `endSession` | Counters, schedule position, banked reinforcers, money, session reset |
| `client/src/lib/rewardSchedules.ts` | `getNextRewardTarget`, `getSequenceForInput`, `generateRewardIntervals` (medium variation), `orderRewardIntervalsNearAverage`, `getGeneratedRewardSequenceLength` | The next reinforcer target for fixed, custom and variable schedules |
| `client/src/lib/useExternalInput.ts` | the `keydown` listener, `canTrigger` | Keyboard responses reach `handleInputActivation`; the 50 ms debounce decides which presses count |
| `client/src/lib/normalizeConfig.ts` | `normalizeSessionConfig`, `normalizeConfig`, `normalizeInput` | Defaults applied to the stored config before the session runs |
| `client/src/lib/api.ts` | `getSessionData`, `logEvent`, `endSession` | The harness reads the requests these send; a changed path or body is a harness error, not a reward bug |

The harness pins `react`, `react-dom`, `react-router-dom`, `zustand`, `clsx`, `tailwind-merge`, `class-variance-authority` and `@radix-ui/react-slot` in `harness/package.json` to the versions in the root `package-lock.json` at the sync commit. When the root lockfile moves one of them, change it in `harness/package.json`, run `bun install` on a copy of that file in an empty directory outside the repo, and copy the new `bun.lock` back to `harness/`.

## Scope

**Tool.** No verifier runs on TypeScript and React code, so the check tests the real code with generated inputs: fast-check 4.10.2 on bun (1.2 or later, written with 1.4.4), with happy-dom 21.0.4 as the DOM. A TLA+ model was the wrong tool here: `handleInputActivation` is one synchronous step per response, so the open question is every sequence of presses, and a hand-written model would only be a second copy of that function.

**Bounds of one run.** 1000 generated sessions with a new seed each run, plus 1000 variable-schedule cycles. A session has two or three inputs (screen buttons or keys), up to 40 presses, reward intervals from 1 to 4, custom lists of up to four points, 0 to 12 cents per reinforcer, a money limit from 1 to 120 cents, a starting balance below the limit or up to 10 cents above it, and a changeover delay of 60, 250 or 1000 ms. Gaps between presses include 0 ms and the exact edges of the delay window and of the key debounce. A pass covers those sessions. It is strong evidence for the contract and it is a test, so it is short of a proof for every session.

Inside a session the next target of a variable schedule is read from the store, because it is random; `[variable-schedule-average]` checks the generated cycle itself, for `awardInterval` from 1 to 40 and cycles of 1 to 120 rewards.

**Stand-ins.** `fetch` is replaced by a stub that accepts every write at once, `Audio` by a counter, `Date.now()` by a clock that the harness sets before each press, and `Math.random` by a seeded generator. Everything else is the product code.

**Outside this check.**
- Gamepad buttons and axes (the `requestAnimationFrame` polling in `useExternalInput.ts`).
- Pauses and resumes; `pauseEnabled` is always false here.
- Time-limit endings, and slow or failed writes. `tests/session-completion.spec.ts` covers those in a real browser.
- Sequence runs: the `/sequence-run` route, the sequence balance, and the server adding `awardedCents` to it in `server/src/routes/events.ts`.
- Legacy three-button configs (`convertLegacyConfig`).
- The configuration page's schedule tools: low and high variation, resizing, balancing the last point.
- The server: validation, storage, `normalizeClickValue`, analytics.
- While F1 is open, any second fault that shows only on F1's exact trigger response.

Use `/maintain-formal-verification-skill` to bring this skill back in line after changes that landed without rerunning it.
