import type { InputConfig, RewardSchedule } from '../types';

export type RewardVariation = 'low' | 'medium' | 'high';

export function normalizeRewardInterval(value: number | undefined): number {
  return Math.max(1, Math.round(value ?? 1));
}

export function sanitizeRewardIntervals(intervals: number[] | undefined): number[] {
  if (!Array.isArray(intervals)) return [];
  return intervals
    .map((interval) => normalizeRewardInterval(interval))
    .filter((interval) => interval > 0);
}

export function getRewardIntervalsTotal(intervals: number[]): number {
  return intervals.reduce((total, interval) => total + interval, 0);
}

export function getRewardIntervalsAverage(intervals: number[]): number {
  if (intervals.length === 0) return 0;
  return getRewardIntervalsTotal(intervals) / intervals.length;
}

export function getGeneratedRewardSequenceLength(timeLimitSeconds: number | undefined): number {
  return Math.max(1, Math.round(timeLimitSeconds ?? 1));
}

function getVariationBounds(averageInterval: number, variation: RewardVariation): { min: number; max: number } {
  if (averageInterval === 1) {
    return { min: 1, max: 1 };
  }

  const deviation = variation === 'low'
    ? Math.max(1, Math.floor(averageInterval * 0.25))
    : variation === 'medium'
      ? Math.max(1, Math.floor(averageInterval * 0.5))
      : averageInterval - 1;

  return {
    min: Math.max(1, averageInterval - deviation),
    max: averageInterval + deviation,
  };
}

function shuffleNumbers(values: number[]): number[] {
  const shuffled = [...values];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function orderRewardIntervalsNearAverage(values: number[], averageInterval: number): number[] {
  const remaining = shuffleNumbers(values);
  const ordered: number[] = [];
  let runningSum = 0;

  while (remaining.length > 0) {
    const nextCount = ordered.length + 1;
    const bestChoices = remaining
      .map((target, index) => ({
        target,
        index,
        distance: Math.abs((runningSum + target) / nextCount - averageInterval),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(3, remaining.length));
    const choice = bestChoices[Math.floor(Math.random() * bestChoices.length)];
    const [target] = remaining.splice(choice.index, 1);
    ordered.push(target);
    runningSum += target;
  }

  return ordered;
}

export function generateRewardIntervals(
  averageIntervalValue: number | undefined,
  countValue: number | undefined,
  variation: RewardVariation = 'medium',
): number[] {
  const averageInterval = normalizeRewardInterval(averageIntervalValue);
  const count = Math.max(1, Math.round(countValue ?? 1));
  if (averageInterval === 1) {
    return Array(count).fill(1);
  }

  const targetTotal = averageInterval * count;
  const { min, max } = getVariationBounds(averageInterval, variation);
  const intervals: number[] = [];
  let runningSum = 0;

  for (let index = 0; index < count; index += 1) {
    const remainingSlots = count - index - 1;
    const lowestPossible = targetTotal - runningSum - (remainingSlots * max);
    const highestPossible = targetTotal - runningSum - (remainingSlots * min);
    const candidateMin = Math.max(min, lowestPossible);
    const candidateMax = Math.min(max, highestPossible);
    const interval = index === count - 1
      ? targetTotal - runningSum
      : candidateMin + Math.floor(Math.random() * (candidateMax - candidateMin + 1));

    intervals.push(interval);
    runningSum += interval;
  }

  return orderRewardIntervalsNearAverage(intervals, averageInterval);
}

export function resizeRewardIntervals(
  intervals: number[] | undefined,
  nextCountValue: number,
  averageIntervalValue: number | undefined,
): number[] {
  const nextCount = Math.max(1, Math.round(nextCountValue || 1));
  const averageInterval = normalizeRewardInterval(averageIntervalValue);
  const current = sanitizeRewardIntervals(intervals);

  if (current.length === nextCount) return current;
  if (current.length > nextCount) return current.slice(0, nextCount);
  return [...current, ...Array(nextCount - current.length).fill(averageInterval)];
}

export function balanceLastRewardInterval(
  intervals: number[] | undefined,
  averageIntervalValue: number | undefined,
): number[] {
  const current = sanitizeRewardIntervals(intervals);
  const averageInterval = normalizeRewardInterval(averageIntervalValue);
  const base = current.length > 0 ? current : [averageInterval];
  if (base.length === 1) return [averageInterval];

  const targetTotal = averageInterval * base.length;
  const previousTotal = getRewardIntervalsTotal(base.slice(0, -1));
  return [...base.slice(0, -1), Math.max(1, targetTotal - previousTotal)];
}

export function getRewardScheduleMode(schedule: RewardSchedule | undefined): RewardSchedule {
  return schedule ?? 'fixed';
}

function getSequenceForInput(
  input: Pick<InputConfig, 'awardInterval' | 'rewardSchedule' | 'rewardIntervals'>,
  generatedSequenceLength: number,
): number[] {
  const schedule = getRewardScheduleMode(input.rewardSchedule);
  const averageInterval = normalizeRewardInterval(input.awardInterval);

  if (schedule === 'custom') {
    const customIntervals = sanitizeRewardIntervals(input.rewardIntervals);
    return customIntervals.length > 0 ? customIntervals : [averageInterval];
  }

  if (schedule === 'variable') {
    return generateRewardIntervals(averageInterval, generatedSequenceLength, 'medium');
  }

  return [averageInterval];
}

export function getNextRewardTarget(
  input: Pick<InputConfig, 'awardInterval' | 'rewardSchedule' | 'rewardIntervals'>,
  existingSequence: number[] = [],
  generatedSequenceLength = 1,
): { target: number; sequence: number[] } {
  const schedule = getRewardScheduleMode(input.rewardSchedule);
  const averageInterval = normalizeRewardInterval(input.awardInterval);
  if (schedule === 'fixed') {
    return { target: averageInterval, sequence: [] };
  }

  const sequence = existingSequence.length > 0
    ? existingSequence
    : getSequenceForInput(input, generatedSequenceLength);
  const [target, ...remainingSequence] = sequence;
  return { target: target ?? averageInterval, sequence: remainingSequence };
}

export function formatRewardAverage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatRewardScheduleSummary(
  input: Pick<InputConfig, 'awardInterval' | 'rewardSchedule' | 'rewardIntervals'>,
  unit = 'clicks',
): string {
  const schedule = getRewardScheduleMode(input.rewardSchedule);
  const averageInterval = normalizeRewardInterval(input.awardInterval);

  if (schedule === 'custom') {
    const intervals = sanitizeRewardIntervals(input.rewardIntervals);
    if (intervals.length === 0) {
      return `custom point schedule targeting ${averageInterval} ${unit}`;
    }
    return `${intervals.length} point interval${intervals.length !== 1 ? 's' : ''}, avg ${formatRewardAverage(getRewardIntervalsAverage(intervals))} ${unit}`;
  }

  if (schedule === 'variable') {
    return `~${averageInterval} ${unit}`;
  }

  return `${averageInterval} ${unit}`;
}

export function formatRewardScheduleLabel(input: Pick<InputConfig, 'rewardSchedule'>): string {
  const schedule = getRewardScheduleMode(input.rewardSchedule);
  if (schedule === 'custom') return 'Point schedule';
  if (schedule === 'variable') return 'Avg Award Interval';
  return 'Award Interval';
}
