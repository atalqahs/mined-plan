import { describe, expect, it } from 'vitest';
import { classifyReminder, nextOccurrenceAfter, stepOccurrence } from '@/domain/reminders/schedule';
import { fromWallClock, toWallClock } from '@/domain/reminders/zonedTime';
import { ReminderScheduler, type ReminderEvent } from '@/application/services/reminderScheduler';
import { groupReminders } from '@/application/queries/reminders';
import { makeApp } from './helpers';

describe('zoned time', () => {
  it('round-trips wall clock across DST (America/New_York)', () => {
    const d = fromWallClock({ year: 2026, month: 3, day: 8, hour: 9, minute: 0, second: 0 }, 'America/New_York');
    expect(d.toISOString()).toBe('2026-03-08T13:00:00.000Z'); // EDT, UTC-4
    expect(toWallClock(d, 'America/New_York').hour).toBe(9);
  });
});

describe('recurrence', () => {
  it('keeps 09:00 local time across a DST change', () => {
    const start = new Date('2026-03-07T14:00:00Z'); // 09:00 EST
    const next = stepOccurrence(start, 'daily', 'America/New_York');
    expect(next.toISOString()).toBe('2026-03-08T13:00:00.000Z'); // 09:00 EDT
  });
  it('clamps monthly recurrences to month end and keeps the anchor day', () => {
    const r = { dueAt: '2026-01-31T09:00:00Z', timezone: 'UTC', repeatRule: 'monthly' as const };
    expect(nextOccurrenceAfter(r, new Date('2026-02-01T00:00:00Z'))!.toISOString()).toBe('2026-02-28T09:00:00.000Z');
    expect(nextOccurrenceAfter(r, new Date('2026-03-01T00:00:00Z'))!.toISOString()).toBe('2026-03-31T09:00:00.000Z');
  });
  it('skips backlog of missed occurrences', () => {
    const r = { dueAt: '2026-01-01T09:00:00Z', timezone: 'UTC', repeatRule: 'weekly' as const };
    expect(nextOccurrenceAfter(r, new Date('2026-02-01T00:00:00Z'))!.toISOString()).toBe('2026-02-05T09:00:00.000Z');
  });
});

describe('classification', () => {
  const base = { id: 'r', nodeId: 'n', timezone: 'Asia/Riyadh', completed: false, notificationState: 'pending' as const };
  const now = new Date('2026-03-10T09:00:00Z'); // 12:00 Riyadh
  it('buckets by viewer-local day', () => {
    expect(classifyReminder({ ...base, dueAt: '2026-03-10T08:00:00Z' }, now, 'Asia/Riyadh')).toBe('overdue');
    expect(classifyReminder({ ...base, dueAt: '2026-03-10T20:00:00Z' }, now, 'Asia/Riyadh')).toBe('today'); // 23:00 local
    expect(classifyReminder({ ...base, dueAt: '2026-03-10T21:30:00Z' }, now, 'Asia/Riyadh')).toBe('upcoming'); // 00:30 next day
    expect(classifyReminder({ ...base, dueAt: '2026-03-01T00:00:00Z', completed: true }, now, 'Asia/Riyadh')).toBe('completed');
  });
});

describe('ReminderScheduler', () => {
  it('reports missed reminders on startup and fires due ones while running', async () => {
    const { commands, store, clock } = await makeApp();
    const n = commands.createNode({ title: 'مشروع' });
    const missed = commands.addReminder(n.id, '2026-03-10T08:00:00Z', 'UTC');
    const later = commands.addReminder(n.id, '2026-03-10T09:00:10Z', 'UTC');
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = new ReminderScheduler(store, commands, clock, { setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {} });
    const events: ReminderEvent[] = [];
    scheduler.on((e) => events.push(e));
    scheduler.start();
    expect(events[0]).toMatchObject({ type: 'missed' });
    expect(store.getSnapshot().reminders.get(missed.id)!.notificationState).toBe('missed');
    clock.advance(11_000);
    timers.at(-1)!.fn();
    expect(events.at(-1)).toMatchObject({ type: 'due' });
    expect(store.getSnapshot().reminders.get(later.id)!.notificationState).toBe('notified');
    // Missed bookkeeping is not undoable user history.
    expect(store.peekUndoLabel()).toBe('addReminder');
    scheduler.stop();
  });

  it('completing a recurring reminder advances it; groups update', async () => {
    const { commands, store, clock } = await makeApp();
    const n = commands.createNode({ title: 'رياضة' });
    const r = commands.addReminder(n.id, '2026-03-10T06:00:00Z', 'UTC', 'daily');
    commands.completeReminder(r.id);
    const next = store.getSnapshot().reminders.get(r.id)!;
    expect(next.completed).toBe(false);
    expect(next.dueAt).toBe('2026-03-11T06:00:00.000Z');
    const g = groupReminders(store.getSnapshot(), clock.now(), 'UTC');
    expect(g.upcoming.length).toBe(1);
    const once = commands.addReminder(n.id, '2026-03-10T10:00:00Z', 'UTC');
    commands.completeReminder(once.id);
    expect(groupReminders(store.getSnapshot(), clock.now(), 'UTC').completed.length).toBe(1);
  });
});
