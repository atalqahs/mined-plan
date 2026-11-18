import type { GraphSnapshot, MindNode, MindReminder } from '@/domain/entities/types';
import { classifyReminder, type ReminderBucket } from '@/domain/reminders/schedule';

export interface ReminderItem {
  reminder: MindReminder;
  node: MindNode | undefined;
}

export type ReminderGroups = Record<ReminderBucket, ReminderItem[]>;

export function groupReminders(snapshot: GraphSnapshot, now: Date, viewerTz: string): ReminderGroups {
  const groups: ReminderGroups = { overdue: [], today: [], upcoming: [], completed: [] };
  for (const r of snapshot.reminders.values()) {
    groups[classifyReminder(r, now, viewerTz)].push({ reminder: r, node: snapshot.nodes.get(r.nodeId) });
  }
  const byDue = (a: ReminderItem, b: ReminderItem) => a.reminder.dueAt.localeCompare(b.reminder.dueAt);
  groups.overdue.sort(byDue);
  groups.today.sort(byDue);
  groups.upcoming.sort(byDue);
  groups.completed.sort((a, b) => (b.reminder.completedAt ?? '').localeCompare(a.reminder.completedAt ?? ''));
  return groups;
}

export function remindersForNode(snapshot: GraphSnapshot, nodeId: string): MindReminder[] {
  return [...snapshot.reminders.values()].filter((r) => r.nodeId === nodeId).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** Count needing attention (overdue + due today). */
export function attentionCount(groups: ReminderGroups): number {
  return groups.overdue.length + groups.today.length;
}
