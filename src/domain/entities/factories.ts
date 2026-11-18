import type { MindEdge, MindNode, MindReminder, NodeStatus, RepeatRule, Vec3 } from './types';
import { assertValidIsoDate, assertValidTimezone, CATEGORY_MAX, clampText, DESCRIPTION_MAX, isHexColor, normalizeTitle, RELATION_MAX } from '../rules/validation';
import { DomainError } from '../rules/errors';

export interface NewNodeInput {
  title: string;
  description?: string;
  parentId?: string | null;
  category?: string;
  color?: string;
  status?: NodeStatus;
  deadline?: string | null;
}

export function createNode(id: string, input: NewNodeInput, position: Vec3, nowIso: string): MindNode {
  if (input.deadline) assertValidIsoDate(input.deadline);
  return {
    id,
    title: normalizeTitle(input.title),
    description: clampText(input.description ?? '', DESCRIPTION_MAX),
    parentId: input.parentId ?? null,
    category: clampText((input.category ?? '').trim(), CATEGORY_MAX),
    position,
    ...(isHexColor(input.color) ? { color: input.color } : {}),
    status: input.status ?? 'active',
    deadline: input.deadline ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export type NodeChanges = Partial<Pick<MindNode, 'title' | 'description' | 'category' | 'color' | 'status' | 'deadline' | 'position'>>;

export function applyNodeChanges(node: MindNode, changes: NodeChanges, nowIso: string): MindNode {
  const next: MindNode = { ...node, updatedAt: nowIso };
  if (changes.title !== undefined) next.title = normalizeTitle(changes.title);
  if (changes.description !== undefined) next.description = clampText(changes.description, DESCRIPTION_MAX);
  if (changes.category !== undefined) next.category = clampText(changes.category.trim(), CATEGORY_MAX);
  if (changes.status !== undefined) next.status = changes.status;
  if (changes.position !== undefined) next.position = changes.position;
  if ('color' in changes) {
    if (changes.color && isHexColor(changes.color)) next.color = changes.color;
    else delete next.color;
  }
  if ('deadline' in changes) {
    if (changes.deadline) assertValidIsoDate(changes.deadline);
    next.deadline = changes.deadline ?? null;
  }
  return next;
}

export function createEdge(id: string, sourceNodeId: string, targetNodeId: string, relationType: string, nowIso: string): MindEdge {
  if (sourceNodeId === targetNodeId) throw new DomainError('EDGE_SELF_LOOP');
  return { id, sourceNodeId, targetNodeId, relationType: clampText(relationType.trim(), RELATION_MAX), createdAt: nowIso };
}

export interface NewReminderInput {
  nodeId: string;
  dueAt: string;
  timezone: string;
  repeatRule?: RepeatRule;
  note?: string;
}

export function createReminder(id: string, input: NewReminderInput): MindReminder {
  assertValidIsoDate(input.dueAt);
  assertValidTimezone(input.timezone);
  return {
    id,
    nodeId: input.nodeId,
    dueAt: new Date(input.dueAt).toISOString(),
    timezone: input.timezone,
    ...(input.repeatRule ? { repeatRule: input.repeatRule } : {}),
    completed: false,
    completedAt: null,
    notificationState: 'pending',
    ...(input.note ? { note: clampText(input.note, 200) } : {}),
  };
}
