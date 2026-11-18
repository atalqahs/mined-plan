import type { GraphSnapshot, MindEdge, MindNode, MindReminder } from '@/domain/entities/types';

/**
 * A Patch is the unit of change: every command produces one. Patches are
 * applied to the in-memory snapshot, persisted atomically, and inverted for undo.
 */
export interface TablePatch<T> {
  put: T[];
  del: string[];
}

export interface Patch {
  nodes: TablePatch<MindNode>;
  edges: TablePatch<MindEdge>;
  reminders: TablePatch<MindReminder>;
}

export function emptyPatch(): Patch {
  return { nodes: { put: [], del: [] }, edges: { put: [], del: [] }, reminders: { put: [], del: [] } };
}

export function isEmptyPatch(p: Patch): boolean {
  return !p.nodes.put.length && !p.nodes.del.length && !p.edges.put.length && !p.edges.del.length && !p.reminders.put.length && !p.reminders.del.length;
}

function applyTable<T extends { id: string }>(map: ReadonlyMap<string, T>, t: TablePatch<T>): ReadonlyMap<string, T> {
  if (!t.put.length && !t.del.length) return map;
  const next = new Map(map);
  for (const id of t.del) next.delete(id);
  for (const item of t.put) next.set(item.id, item);
  return next;
}

/** Structural sharing: untouched tables keep their identity (cheap equality for subscribers). */
export function applyPatch(s: GraphSnapshot, p: Patch): GraphSnapshot {
  return {
    nodes: applyTable(s.nodes, p.nodes),
    edges: applyTable(s.edges, p.edges),
    reminders: applyTable(s.reminders, p.reminders),
  };
}

function invertTable<T extends { id: string }>(map: ReadonlyMap<string, T>, t: TablePatch<T>): TablePatch<T> {
  const put: T[] = [];
  const del: string[] = [];
  const touched = new Set<string>();
  for (const item of t.put) {
    if (touched.has(item.id)) continue;
    touched.add(item.id);
    const prev = map.get(item.id);
    if (prev) put.push(prev);
    else del.push(item.id);
  }
  for (const id of t.del) {
    if (touched.has(id)) continue;
    touched.add(id);
    const prev = map.get(id);
    if (prev) put.push(prev);
  }
  return { put, del };
}

/** Inverse of `p` relative to the snapshot it is about to be applied to. */
export function invertPatch(before: GraphSnapshot, p: Patch): Patch {
  return {
    nodes: invertTable(before.nodes, p.nodes),
    edges: invertTable(before.edges, p.edges),
    reminders: invertTable(before.reminders, p.reminders),
  };
}

export function snapshotToReplacePatch(before: GraphSnapshot, after: GraphSnapshot): Patch {
  const p = emptyPatch();
  for (const id of before.nodes.keys()) if (!after.nodes.has(id)) p.nodes.del.push(id);
  for (const id of before.edges.keys()) if (!after.edges.has(id)) p.edges.del.push(id);
  for (const id of before.reminders.keys()) if (!after.reminders.has(id)) p.reminders.del.push(id);
  p.nodes.put.push(...after.nodes.values());
  p.edges.put.push(...after.edges.values());
  p.reminders.put.push(...after.reminders.values());
  return p;
}
