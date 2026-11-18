import type { GraphSnapshot, MindEdge, MindNode, NodeStatus, Vec3 } from '@/domain/entities/types';
import { MAX_CHUNK_CHARS, MAX_CHUNKS } from './protocol';

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

/** Split a shared graph into ordered chunks that fit a DataChannel message comfortably. */
export function chunkGraph(graph: SharedGraph, gid: string): Array<{ t: 'graph-chunk'; gid: string; i: number; n: number; data: string }> {
  const json = JSON.stringify(graph);
  const n = Math.max(1, Math.ceil(json.length / MAX_CHUNK_CHARS));
  if (n > MAX_CHUNKS) throw new Error('graph too large to share');
  return Array.from({ length: n }, (_, i) => ({ t: 'graph-chunk' as const, gid, i, n, data: json.slice(i * MAX_CHUNK_CHARS, (i + 1) * MAX_CHUNK_CHARS) }));
}

/** Reassembles chunks of one transfer at a time; a newer transfer id supersedes an unfinished one. */
export class GraphAssembler {
  private gid: string | null = null;
  private parts: string[] = [];
  private received = 0;

  /** Returns the parsed graph JSON when the transfer completes, otherwise null. */
  add(chunk: { gid: string; i: number; n: number; data: string }): unknown {
    if (chunk.gid !== this.gid) {
      this.gid = chunk.gid;
      this.parts = new Array(chunk.n);
      this.received = 0;
    }
    if (chunk.n !== this.parts.length || chunk.i >= chunk.n) return null;
    if (this.parts[chunk.i] === undefined) this.received++;
    this.parts[chunk.i] = chunk.data;
    if (this.received < chunk.n) return null;
    const json = this.parts.join('');
    this.gid = null;
    this.parts = [];
    this.received = 0;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
}
