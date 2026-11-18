import type { MindReminder, RepeatRule } from '../entities/types';
import { dayKey, daysInMonth, fromWallClock, toWallClock, type WallClock } from './zonedTime';

export const REPEAT_RULES: readonly RepeatRule[] = ['daily', 'weekly', 'monthly', 'yearly'];

export function isRepeatRule(v: unknown): v is RepeatRule {
  return typeof v === 'string' && (REPEAT_RULES as readonly string[]).includes(v);
}

/**
 * Next occurrence after one step of `rule`, preserving wall-clock time in the
 * reminder's own timezone (so a 09:00 daily reminder stays 09:00 across DST).
 * Month/year steps clamp to the last valid day (Jan 31 → Feb 28/29).
 */
export function stepOccurrence(dueAt: Date, rule: RepeatRule, tz: string, anchorDay?: number): Date {
  const w = toWallClock(dueAt, tz);
  const next: WallClock = { ...w };
  const day = anchorDay ?? w.day;
  switch (rule) {
    case 'daily':
    case 'weekly': {
      const shifted = new Date(Date.UTC(w.year, w.month - 1, w.day + (rule === 'daily' ? 1 : 7)));
      next.year = shifted.getUTCFullYear();
      next.month = shifted.getUTCMonth() + 1;
      next.day = shifted.getUTCDate();
      break;
    }
    case 'monthly': {
      const m = w.month === 12 ? 1 : w.month + 1;
      const y = w.month === 12 ? w.year + 1 : w.year;
      next.year = y;
      next.month = m;
      next.day = Math.min(day, daysInMonth(y, m));
      break;
    }
    case 'yearly': {
      next.year = w.year + 1;
      next.day = Math.min(day, daysInMonth(next.year, w.month));
      break;
    }
  }
  return fromWallClock(next, tz);
}

/** First occurrence strictly after `after` (skipping any backlog of missed occurrences). */
export function nextOccurrenceAfter(reminder: Pick<MindReminder, 'dueAt' | 'repeatRule' | 'timezone'>, after: Date): Date | null {
  if (!reminder.repeatRule) return null;
  const start = new Date(reminder.dueAt);
  const anchorDay = toWallClock(start, reminder.timezone).day;
  let cur = start;
  for (let guard = 0; guard < 100_000; guard++) {
    cur = stepOccurrence(cur, reminder.repeatRule, reminder.timezone, anchorDay);
    if (cur.getTime() > after.getTime()) return cur;
  }
  return null;
}

export type ReminderBucket = 'overdue' | 'today' | 'upcoming' | 'completed';

/**
 * Bucket a reminder relative to `now`, using calendar days in the viewer's zone.
 *  - completed: marked done
 *  - overdue:   due instant has passed
 *  - today:     due later today
 *  - upcoming:  due on a later day
 */
export function classifyReminder(r: MindReminder, now: Date, viewerTz: string): ReminderBucket {
  if (r.completed) return 'completed';
  const due = new Date(r.dueAt);
  if (due.getTime() <= now.getTime()) return 'overdue';
  return dayKey(due, viewerTz) === dayKey(now, viewerTz) ? 'today' : 'upcoming';
}

export function isDue(r: MindReminder, now: Date): boolean {
  return !r.completed && new Date(r.dueAt).getTime() <= now.getTime();
}
