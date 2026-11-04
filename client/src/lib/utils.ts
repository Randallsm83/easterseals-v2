import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { SessionListItem } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  // Round to avoid floating point precision issues
  const roundedSeconds = Math.round(seconds);
  if (roundedSeconds < 60) {
    return `${roundedSeconds}s`;
  }
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  return remainingSeconds > 0 
    ? `${minutes}m ${remainingSeconds}s` 
    : `${minutes}m`;
}

// Parse SQLite datetime format ("2025-12-09 07:05:28") which lacks the "T" separator
export function parseSqliteDate(timestamp: string): Date {
  // Replace space with T to make it ISO-8601 compliant
  const isoString = timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
  return new Date(isoString);
}

export function formatTimestamp(timestamp: string): string {
  const date = parseSqliteDate(timestamp);
  return date.toLocaleString();
}

export function formatSessionStatus(session: Pick<SessionListItem, 'sequenceStatus' | 'endedAt'>): string {
  if (session.sequenceStatus) {
    return { planned: 'Planned', active: 'Active', completed: 'Completed', interrupted: 'Interrupted' }[session.sequenceStatus];
  }
  return session.endedAt ? 'Completed' : 'Active';
}

export function responsesPerMinute(responses: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Number(((responses / durationSeconds) * 60).toFixed(2));
}

export function calculateAccuracy(correctClicks: number, totalClicks: number): number {
  if (totalClicks === 0) return 0;
  return Number(((correctClicks / totalClicks) * 100).toFixed(1));
}
