import type { GraphSnapshot, MindNode, MindReminder, RepeatRule, Vec3 } from '@/domain/entities/types';
import { applyNodeChanges, createEdge, createNode, createReminder, type NewNodeInput, type NodeChanges } from '@/domain/entities/factories';
import { assertValidParent, buildChildIndex, getDescendantIds } from '@/domain/graph/hierarchy';
import { computeFullLayout, placeNewNode, translateSubtree } from '@/domain/graph/layout';
import { edgePairKey } from '@/domain/graph/integrity';
import { nextOccurrenceAfter } from '@/domain/reminders/schedule';
import { DomainError } from '@/domain/rules/errors';
import { emptyPatch, snapshotToReplacePatch } from '../patch';
import type { GraphStore } from '../services/graphStore';
import type { Clock } from '../ports';

/** Command labels are stable codes; the UI translates them for undo/redo toasts. */
export type CommandLabel =
  | 'createNode'
  | 'updateNode'
  | 'moveNode'
  | 'repositionNode'
  | 'deleteNode'
  | 'connect'
  | 'updateEdge'
  | 'disconnect'
  | 'addReminder'
  | 'updateReminder'
  | 'completeReminder'
  | 'reopenReminder'
  | 'deleteReminder'
  | 'relayout'
  | 'import'
  | 'seed';

export type DeleteMode = 'cascade' | 'promoteChildren';

/**
 * Application commands. Each validates against domain rules, builds a Patch and
 * commits it to the GraphStore (which handles persistence and undo).
 */
export class MindCommands {
  constructor(
    private readonly store: GraphStore,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {}

  private get s(): GraphSnapshot {
    return this.store.getSnapshot();
  }
  private nowIso() {
    return this.clock.now().toISOString();
  }
  private requireNode(id: string): MindNode {
    const n = this.s.nodes.get(id);
    if (!n) throw new DomainError('NODE_NOT_FOUND', id);
    return n;
  }

  createNode(input: NewNodeInput): MindNode {
    const parentId = input.parentId ?? null;
    if (parentId && !this.s.nodes.has(parentId)) throw new DomainError('PARENT_NOT_FOUND', parentId);
    const parent = parentId ? this.s.nodes.get(parentId) : undefined;
    const node = createNode(
      this.newId(),
      { ...input, parentId, category: input.category ?? parent?.category ?? '' },
      placeNewNode(this.s, parentId),
      this.nowIso(),
    );
    const p = emptyPatch();
    p.nodes.put.push(node);
    this.store.commit('createNode', p);
    return node;
  }

  updateNode(id: string, changes: NodeChanges, options: { coalesce?: boolean } = {}): void {
    const node = this.requireNode(id);
    const next = applyNodeChanges(node, changes, this.nowIso());
    const { updatedAt: _a, ...a } = node;
    const { updatedAt: _b, ...b } = next;
    if (JSON.stringify(a) === JSON.stringify(b)) return; // no-op edits don't pollute history
    const p = emptyPatch();
    p.nodes.put.push(next);
    this.store.commit('updateNode', p, options.coalesce ? { mergeKey: `node:${id}:${Object.keys(changes).sort().join(',')}` } : {});
  }

  /** Re-parent a node (null = make it a primary idea). Cross-connections are untouched. */
  moveNode(id: string, newParentId: string | null): void {
    const node = this.requireNode(id);
    assertValidParent(this.s.nodes, id, newParentId);
    if (node.parentId === newParentId) return;
    // Place relative to the new parent (ignoring the moving branch), then shift the whole subtree with it.
    const subtree = new Set([id, ...getDescendantIds(this.s.nodes, id)]);
    const others = new Map([...this.s.nodes].filter(([k]) => !subtree.has(k)));
    const target = placeNewNode({ ...this.s, nodes: others }, newParentId);
    const moved = translateSubtree(this.s.nodes, id, target);
    const now = this.nowIso();
    const p = emptyPatch();
    for (const [nid, pos] of moved) {
      const n = this.s.nodes.get(nid)!;
      p.nodes.put.push({ ...n, position: pos, ...(nid === id ? { parentId: newParentId, updatedAt: now } : {}) });
    }
    this.store.commit('moveNode', p);
  }

  /** Spatial move (drag). Moves the subtree rigidly so the branch keeps its shape. */
  repositionNode(id: string, position: Vec3): void {
    this.requireNode(id);
    const moved = translateSubtree(this.s.nodes, id, position);
    const p = emptyPatch();
    for (const [nid, pos] of moved) p.nodes.put.push({ ...this.s.nodes.get(nid)!, position: pos });
    this.store.commit('repositionNode', p);
  }

  deleteNode(id: string, mode: DeleteMode): void {
    const node = this.requireNode(id);
    const childIndex = buildChildIndex(this.s.nodes);
    const removed = new Set<string>([id]);
    const p = emptyPatch();
    if (mode === 'cascade') {
      for (const d of getDescendantIds(this.s.nodes, id, childIndex)) removed.add(d);
    } else {
      const now = this.nowIso();
      for (const childId of childIndex.get(id) ?? []) {
        p.nodes.put.push({ ...this.s.nodes.get(childId)!, parentId: node.parentId, updatedAt: now });
      }
    }
    p.nodes.del.push(...removed);
    for (const e of this.s.edges.values()) if (removed.has(e.sourceNodeId) || removed.has(e.targetNodeId)) p.edges.del.push(e.id);
    for (const r of this.s.reminders.values()) if (removed.has(r.nodeId)) p.reminders.del.push(r.id);
    this.store.commit('deleteNode', p);
  }

  connect(sourceId: string, targetId: string, relationType = ''): string {
    this.requireNode(sourceId);
    this.requireNode(targetId);
    if (sourceId === targetId) throw new DomainError('EDGE_SELF_LOOP');
    const key = edgePairKey(sourceId, targetId);
    for (const e of this.s.edges.values()) if (edgePairKey(e.sourceNodeId, e.targetNodeId) === key) throw new DomainError('EDGE_DUPLICATE');
    const edge = createEdge(this.newId(), sourceId, targetId, relationType, this.nowIso());
    const p = emptyPatch();
    p.edges.put.push(edge);
    this.store.commit('connect', p);
    return edge.id;
  }

  updateEdge(edgeId: string, relationType: string): void {
    const e = this.s.edges.get(edgeId);
    if (!e) throw new DomainError('EDGE_NOT_FOUND', edgeId);
    if (e.relationType === relationType.trim()) return;
    const p = emptyPatch();
    p.edges.put.push(createEdge(e.id, e.sourceNodeId, e.targetNodeId, relationType, e.createdAt));
    this.store.commit('updateEdge', p);
  }

  disconnect(edgeId: string): void {
    if (!this.s.edges.has(edgeId)) throw new DomainError('EDGE_NOT_FOUND', edgeId);
    const p = emptyPatch();
    p.edges.del.push(edgeId);
    this.store.commit('disconnect', p);
  }

  addReminder(nodeId: string, dueAt: string, timezone: string, repeatRule?: RepeatRule, note?: string): MindReminder {
    this.requireNode(nodeId);
    const r = createReminder(this.newId(), { nodeId, dueAt, timezone, repeatRule, note });
    const p = emptyPatch();
    p.reminders.put.push(r);
    this.store.commit('addReminder', p);
    return r;
  }

  updateReminder(id: string, changes: { dueAt?: string; repeatRule?: RepeatRule | null; note?: string }): void {
    const r = this.requireReminder(id);
    const next = createReminder(r.id, {
      nodeId: r.nodeId,
      dueAt: changes.dueAt ?? r.dueAt,
      timezone: r.timezone,
      repeatRule: changes.repeatRule === null ? undefined : (changes.repeatRule ?? r.repeatRule),
      note: changes.note ?? r.note,
    });
    const p = emptyPatch();
    p.reminders.put.push({ ...next, completed: r.completed, completedAt: r.completedAt ?? null });
    this.store.commit('updateReminder', p);
  }

  /** Completing a recurring reminder advances it to its next future occurrence. */
  completeReminder(id: string): void {
    const r = this.requireReminder(id);
    const now = this.clock.now();
    const p = emptyPatch();
    const next = nextOccurrenceAfter(r, now);
    if (next) p.reminders.put.push({ ...r, dueAt: next.toISOString(), completedAt: now.toISOString(), notificationState: 'pending', completed: false });
    else p.reminders.put.push({ ...r, completed: true, completedAt: now.toISOString() });
    this.store.commit('completeReminder', p);
  }

  reopenReminder(id: string): void {
    const r = this.requireReminder(id);
    const p = emptyPatch();
    p.reminders.put.push({ ...r, completed: false, completedAt: null, notificationState: new Date(r.dueAt) <= this.clock.now() ? 'notified' : 'pending' });
    this.store.commit('reopenReminder', p);
  }

  deleteReminder(id: string): void {
    this.requireReminder(id);
    const p = emptyPatch();
    p.reminders.del.push(id);
    this.store.commit('deleteReminder', p);
  }

  /** System bookkeeping (not undoable): record that a reminder was delivered or missed. */
  markReminderDelivery(ids: string[], state: 'notified' | 'missed'): void {
    const p = emptyPatch();
    for (const id of ids) {
      const r = this.s.reminders.get(id);
      if (r && r.notificationState !== state) p.reminders.put.push({ ...r, notificationState: state });
    }
    this.store.commit('updateReminder', p, { undoable: false });
  }

  relayout(): void {
    const positions = computeFullLayout(this.s);
    const p = emptyPatch();
    for (const [id, pos] of positions) p.nodes.put.push({ ...this.s.nodes.get(id)!, position: pos });
    this.store.commit('relayout', p);
  }

  /** Replace the entire graph (import). Undoable as a single step. */
  replaceAll(next: GraphSnapshot, label: CommandLabel = 'import'): void {
    this.store.commit(label, snapshotToReplacePatch(this.s, next));
  }

  private requireReminder(id: string): MindReminder {
    const r = this.s.reminders.get(id);
    if (!r) throw new DomainError('REMINDER_NOT_FOUND', id);
    return r;
  }
}
