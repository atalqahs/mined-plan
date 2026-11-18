import type { GraphSnapshot, MindEdge, MindNode, MindReminder } from '../entities/types';
import { getAncestorIds } from './hierarchy';

export interface IntegrityReport {
  /** Nodes whose parent pointed at a missing node; re-attached as primary ideas. */
  orphanedNodes: string[];
  /** Nodes whose parent chain formed a cycle; detached to break it. */
  brokenCycles: string[];
  /** Edges/reminders that reference missing nodes (kept aside, never silently dropped). */
  danglingEdges: MindEdge[];
  danglingReminders: MindReminder[];
  duplicateEdges: MindEdge[];
}

export function isCleanReport(r: IntegrityReport): boolean {
  return !r.orphanedNodes.length && !r.brokenCycles.length && !r.danglingEdges.length && !r.danglingReminders.length && !r.duplicateEdges.length;
}

/**
 * Validate structural invariants and return a repaired snapshot plus a report.
 * Repairs are conservative: nodes are never deleted; invalid references are
 * reported so callers can quarantine them instead of discarding user data.
 */
export function repairSnapshot(input: GraphSnapshot): { snapshot: GraphSnapshot; report: IntegrityReport } {
  const nodes = new Map<string, MindNode>(input.nodes);
  const report: IntegrityReport = { orphanedNodes: [], brokenCycles: [], danglingEdges: [], danglingReminders: [], duplicateEdges: [] };

  for (const n of nodes.values()) {
    if (n.parentId && !nodes.has(n.parentId)) {
      nodes.set(n.id, { ...n, parentId: null });
      report.orphanedNodes.push(n.id);
    }
  }
  for (const n of [...nodes.values()]) {
    const cur = nodes.get(n.id)!;
    if (!cur.parentId) continue;
    // Walk up; if we revisit the node, the chain is cyclic.
    const seen = new Set<string>([cur.id]);
    let p: string | null = cur.parentId;
    while (p) {
      if (seen.has(p)) {
        nodes.set(cur.id, { ...cur, parentId: null });
        report.brokenCycles.push(cur.id);
        break;
      }
      seen.add(p);
      p = nodes.get(p)?.parentId ?? null;
    }
  }

  const edges = new Map<string, MindEdge>();
  const pairKeys = new Set<string>();
  for (const e of input.edges.values()) {
    if (!nodes.has(e.sourceNodeId) || !nodes.has(e.targetNodeId) || e.sourceNodeId === e.targetNodeId) {
      report.danglingEdges.push(e);
      continue;
    }
    const key = edgePairKey(e.sourceNodeId, e.targetNodeId);
    if (pairKeys.has(key)) {
      report.duplicateEdges.push(e);
      continue;
    }
    pairKeys.add(key);
    edges.set(e.id, e);
  }

  const reminders = new Map<string, MindReminder>();
  for (const r of input.reminders.values()) {
    if (!nodes.has(r.nodeId)) report.danglingReminders.push(r);
    else reminders.set(r.id, r);
  }

  // Sanity: no cycles remain.
  for (const n of nodes.values()) if (getAncestorIds(nodes, n.id).includes(n.id)) throw new Error('cycle repair failed');

  return { snapshot: { nodes, edges, reminders }, report };
}

/** Undirected key — a cross-connection between A and B is unique regardless of direction. */
export function edgePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
