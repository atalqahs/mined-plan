/**
 * Core domain entities. Pure data — no framework imports allowed in /domain.
 */

export type Vec3 = [number, number, number];

export type NodeStatus = 'active' | 'completed' | 'archived';

export interface MindNode {
  id: string;
  title: string;
  description: string;
  parentId: string | null;
  category: string;
  position: Vec3;
  color?: string;
  status: NodeStatus;
  /** Optional deadline (ISO-8601 UTC). Extension of the base brief model. */
  deadline?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MindEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  createdAt: string;
}

/** Supported recurrence rules (an RRULE-like subset, kept deliberately small). */
export type RepeatRule = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * pending  — not yet delivered
 * notified — delivered while the app was open
 * missed   — became due while the app was closed; surfaced on next startup
 */
export type NotificationState = 'pending' | 'notified' | 'missed';

export interface MindReminder {
  id: string;
  nodeId: string;
  /** Absolute instant, ISO-8601 UTC. */
  dueAt: string;
  /** IANA zone the reminder was authored in; recurrence keeps wall-clock time in this zone. */
  timezone: string;
  repeatRule?: RepeatRule;
  completed: boolean;
  completedAt?: string | null;
  notificationState: NotificationState;
  note?: string;
}

/** Immutable, fully-materialised view of the user's mind graph. */
export interface GraphSnapshot {
  nodes: ReadonlyMap<string, MindNode>;
  edges: ReadonlyMap<string, MindEdge>;
  reminders: ReadonlyMap<string, MindReminder>;
}

export const EMPTY_SNAPSHOT: GraphSnapshot = {
  nodes: new Map(),
  edges: new Map(),
  reminders: new Map(),
};
