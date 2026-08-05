/**
 * Active-time helpers exclude logged pause windows so responses per minute can be
 * computed over the time the session was actually running.
 */
import type { PauseResumeEventRow } from '../types';
import { parseSqliteDate } from './utils';

export interface PausedInterval {
  start: number;
  end: number;
}

export interface ActiveTimeline {
  startMs: number;
  endMs: number;
  pausedMs: number;
  activeMs: number;
  intervals: PausedInterval[];
  /**
   * Active (pause-excluded) ms elapsed from startMs up to atMs. A timestamp
   * inside a paused interval freezes at that interval's start.
   */
  activeMsAt(atMs: number): number;
}

export function buildActiveTimeline(
  startMs: number,
  endMs: number,
  events: PauseResumeEventRow[] | undefined,
): ActiveTimeline {
  const boundEnd = Math.max(startMs, endMs);
  const sortedEvents = (events ?? [])
    .map((event) => ({
      isPause: event.event === 'pause',
      at: parseSqliteDate(event.timestamp).getTime(),
    }))
    .filter(({ at }) => !Number.isNaN(at))
    .sort((a, b) => a.at - b.at);

  let openAt: number | null = null;
  const intervals: PausedInterval[] = [];

  for (const { isPause, at } of sortedEvents) {
    if (isPause) {
      if (openAt === null) {
        openAt = Math.min(Math.max(at, startMs), boundEnd);
      }
    } else if (openAt !== null) {
      const close = Math.min(Math.max(at, startMs), boundEnd);
      if (close > openAt) intervals.push({ start: openAt, end: close });
      openAt = null;
    }
  }

  if (openAt !== null && boundEnd > openAt) {
    intervals.push({ start: openAt, end: boundEnd });
  }

  const pausedMs = intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
  const activeMs = Math.max(0, (boundEnd - startMs) - pausedMs);

  function activeMsAt(atMs: number): number {
    const t = Math.min(Math.max(atMs, startMs), boundEnd);
    let paused = 0;
    for (const interval of intervals) {
      if (interval.start >= t) break;
      paused += Math.min(interval.end, t) - interval.start;
    }
    return Math.max(0, (t - startMs) - paused);
  }

  return {
    startMs,
    endMs: boundEnd,
    pausedMs,
    activeMs,
    intervals,
    activeMsAt,
  };
}
