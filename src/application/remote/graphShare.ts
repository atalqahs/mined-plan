import type { GraphSnapshot, MindEdge, MindNode, NodeStatus, Vec3 } from '@/domain/entities/types';

/**
 * The minimal, display-only projection of the phone's graph that the TV needs.
 * Deliberately excluded: notes/descriptions, deadlines, reminders, timestamps.
 * The phone's dataset stays authoritative; the TV keeps this only in memory.
 */
export interface SharedNode {
  id: string;
  title: string;
  parentId: string | null;
  position: Vec3;
  color?: string;
  status: NodeStatus;
  category: string;
}
export interface SharedEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
}
export interface SharedGraph {
  v: 1;
  nodes: SharedNode[];
  edges: SharedEdge[];
}

export const MAX_SHARED_NODES = 5000;
export const MAX_SHARED_EDGES = 20000;

export function toSharedGraph(s: GraphSnapshot): SharedGraph {
  return {
    v: 1,
    nodes: [...s.nodes.values()].map((n) => ({
      id: n.id,
      title: n.title,
      parentId: n.parentId,
      position: n.position,
      ...(n.color ? { color: n.color } : {}),
      status: n.status,
      category: n.category,
    })),
    edges: [...s.edges.values()].map((e) => ({ id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, relationType: e.relationType })),
  };
}

const EPOCH = '2000-01-01T00:00:00.000Z';
const STATUSES: NodeStatus[] = ['active', 'completed', 'archived'];
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isFiniteVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e5);

/** Validate an untrusted shared graph and rebuild a renderable snapshot (or null if invalid). */
export function fromSharedGraph(raw: unknown): GraphSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Partial<SharedGraph>;
  if (g.v !== 1 || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  if (g.nodes.length > MAX_SHARED_NODES || g.edges.length > MAX_SHARED_EDGES) return null;
  const nodes = new Map<string, MindNode>();
  // Sequential timestamps keep sibling order (createdAt) stable on the TV.
  let k = 0;
  for (const n of g.nodes) {
    if (!n || !isStr(n.id, 128) || !n.id || !isStr(n.title, 120) || !n.title.trim() || !(n.parentId === null || isStr(n.parentId, 128)) || !isFiniteVec(n.position)) return null;
    if (!STATUSES.includes(n.status) || !isStr(n.category ?? '', 40)) return null;
    if (n.color !== undefined && !(typeof n.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(n.color))) return null;
    const at = new Date(Date.parse(EPOCH) + k++ * 1000).toISOString();
    nodes.set(n.id, {
      id: n.id,
      title: n.title,
      description: '',
      parentId: n.parentId,
      category: n.category ?? '',
      position: [n.position[0], n.position[1], n.position[2]],
      ...(n.color ? { color: n.color } : {}),
      status: n.status,
      deadline: null,
      createdAt: at,
      updatedAt: at,
    });
  }
  const edges = new Map<string, MindEdge>();
  for (const e of g.edges) {
    if (!e || !isStr(e.id, 128) || !isStr(e.sourceNodeId, 128) || !isStr(e.targetNodeId, 128) || !isStr(e.relationType ?? '', 40)) return null;
    if (!nodes.has(e.sourceNodeId) || !nodes.has(e.targetNodeId)) continue;
    edges.set(e.id, { id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, relationType: e.relationType ?? '', createdAt: EPOCH });
  }
  return { nodes, edges, reminders: new Map() };
}

/**
 * Graph transfer framing (protocol v2).
 *
 * The graph is split into *parts*: complete arrays of nodes/edges whose serialized frame
 * (including the message envelope) is at most `maxFrameBytes` UTF-8 bytes. Measuring the
 * final frame in bytes avoids two production pitfalls of the v1 string chunks: Arabic text
 * is ~1.8 bytes/char in UTF-8, and JSON-in-JSON escaping inflated every quote.
 */
export const PART_FRAME_BYTES = 6 * 1024;
export const MAX_PARTS = 2_000;
const enc = new TextEncoder();
const bytes = (v: unknown) => enc.encode(JSON.stringify(v)).byteLength;

export interface GraphPart {
  nodes: SharedNode[];
  edges: SharedEdge[];
}

export function buildGraphParts(graph: SharedGraph, maxFrameBytes = PART_FRAME_BYTES): GraphPart[] {
  // Envelope of a part frame with generous placeholders for gid / index / seq.
  const envelope = bytes({ t: 'graph-part', gid: 'x'.repeat(16), i: 99_999, nodes: [], edges: [], seq: 9_999_999_999 });
  const budget = maxFrameBytes - envelope;
  const parts: GraphPart[] = [];
  let cur: GraphPart = { nodes: [], edges: [] };
  let used = 0;
  const push = (kind: 'nodes' | 'edges', item: SharedNode | SharedEdge) => {
    const size = bytes(item) + 1; // + comma
    if (size > budget) throw new Error('a single item exceeds the frame budget');
    if (used + size > budget && (cur.nodes.length || cur.edges.length)) {
      parts.push(cur);
      cur = { nodes: [], edges: [] };
      used = 0;
    }
    (cur[kind] as Array<SharedNode | SharedEdge>).push(item);
    used += size;
  };
  for (const n of graph.nodes) push('nodes', n);
  for (const e of graph.edges) push('edges', e);
  if (cur.nodes.length || cur.edges.length || !parts.length) parts.push(cur);
  if (parts.length > MAX_PARTS) throw new Error('graph too large to share');
  return parts;
}

/**
 * TV-side receiver for one transfer at a time. Bounded: rejects transfers announcing more
 * than the shared-graph limits, parts that don't belong to the current transfer, or totals
 * that disagree with the announcement. A newer transfer id supersedes an unfinished one.
 */
export type ReceiveResult =
  | { status: 'progress'; received: number; total: number }
  | { status: 'complete'; graph: SharedGraph }
  | { status: 'error'; reason: 'invalid' | 'too-large' | 'unexpected' | 'mismatch' };

export class GraphReceiver {
  private gid: string | null = null;
  private expect = { parts: 0, nodes: 0, edges: 0 };
  private parts: Array<GraphPart | undefined> = [];
  private received = 0;

  get activeId(): string | null {
    return this.gid;
  }

  begin(gid: string, parts: number, nodes: number, edges: number): ReceiveResult {
    if (parts < 1 || parts > MAX_PARTS || nodes > MAX_SHARED_NODES || edges > MAX_SHARED_EDGES) {
      this.reset();
      return { status: 'error', reason: 'too-large' };
    }
    this.gid = gid;
    this.expect = { parts, nodes, edges };
    this.parts = new Array(parts);
    this.received = 0;
    return { status: 'progress', received: 0, total: parts };
  }

  add(gid: string, i: number, part: GraphPart): ReceiveResult {
    if (gid !== this.gid || i < 0 || i >= this.expect.parts) return { status: 'error', reason: 'unexpected' };
    if (!this.parts[i]) this.received++;
    this.parts[i] = part;
    if (this.received < this.expect.parts) return { status: 'progress', received: this.received, total: this.expect.parts };
    const graph: SharedGraph = { v: 1, nodes: [], edges: [] };
    for (const p of this.parts) {
      graph.nodes.push(...p!.nodes);
      graph.edges.push(...p!.edges);
    }
    const ok = graph.nodes.length === this.expect.nodes && graph.edges.length === this.expect.edges;
    this.reset();
    return ok ? { status: 'complete', graph } : { status: 'error', reason: 'mismatch' };
  }

  reset(): void {
    this.gid = null;
    this.parts = [];
    this.received = 0;
  }
}
