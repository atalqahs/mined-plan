import type { MindReminder } from '@/domain/entities/types';
import { isDue } from '@/domain/reminders/schedule';
import type { MindCommands } from '../commands/mindCommands';
import type { Clock } from '../ports';
import type { GraphStore } from './graphStore';

export type ReminderEvent =
  | { type: 'due'; reminders: MindReminder[] }
  | { type: 'missed'; reminders: MindReminder[] };

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Long timeouts drift/throttle in background tabs; we re-evaluate at least this often. */
export const MAX_SLEEP_MS = 30_000;

/**
 * In-page reminder scheduler.
 *
 * Honest constraints: this runs only while the app tab is open. Browsers throttle
 * timers in background tabs, so we never sleep longer than MAX_SLEEP_MS and also
 * re-check on visibility/focus. Reminders that came due while the app was closed
 * are detected on startup and reported as "missed" — never silently dropped.
 */
export class ReminderScheduler {
  private handle: unknown = null;
  private listeners = new Set<(e: ReminderEvent) => void>();
  private unsubscribe: (() => void) | null = null;
  private running = false;

  constructor(
    private readonly store: GraphStore,
    private readonly commands: MindCommands,
    private readonly clock: Clock,
    private readonly timers: TimerApi = { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (h) => globalThis.clearTimeout(h as number) },
  ) {}

  on(listener: (e: ReminderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.detectMissed();
    this.unsubscribe = this.store.subscribe(() => this.reschedule());
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  /** Call when the page regains visibility/focus to catch up immediately. */
  wake(): void {
    if (this.running) this.tick();
  }

  private detectMissed() {
    const now = this.clock.now();
    const missed = [...this.store.getSnapshot().reminders.values()].filter((r) => r.notificationState === 'pending' && isDue(r, now));
    if (!missed.length) return;
    this.commands.markReminderDelivery(
      missed.map((r) => r.id),
      'missed',
    );
    this.emit({ type: 'missed', reminders: missed });
  }

  private tick = () => {
    if (!this.running) return;
    const now = this.clock.now();
    const due = [...this.store.getSnapshot().reminders.values()].filter((r) => r.notificationState === 'pending' && isDue(r, now));
    if (due.length) {
      this.commands.markReminderDelivery(
        due.map((r) => r.id),
        'notified',
      );
      this.emit({ type: 'due', reminders: due });
    }
    this.reschedule();
  };

  private reschedule() {
    if (!this.running) return;
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    const now = this.clock.now().getTime();
    let soonest = Infinity;
    for (const r of this.store.getSnapshot().reminders.values()) {
      if (r.completed || r.notificationState !== 'pending') continue;
      soonest = Math.min(soonest, new Date(r.dueAt).getTime());
    }
    const delay = Math.max(250, Math.min(MAX_SLEEP_MS, soonest - now));
    this.handle = this.timers.setTimeout(this.tick, delay);
  }

  private emit(e: ReminderEvent) {
    for (const l of this.listeners) l(e);
  }
}
