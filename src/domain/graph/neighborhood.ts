import type { GraphSnapshot } from '../entities/types';

/**
 * Undirected adjacency over BOTH hierarchical (parent/child) and independent
 * (cross-connection) relationships. Used by Focus Mode and keyboard navigation.
 */
export function buildAdjacency(snapshot: GraphSnapshot): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let sa = adj.get(a);
    if (!sa) adj.set(a, (sa = new Set()));
    sa.add(b);
    let sb = adj.get(b);
    if (!sb) adj.set(b, (sb = new Set()));
    sb.add(a);
  };
  for (const n of snapshot.nodes.values()) {
    if (!adj.has(n.id)) adj.set(n.id, new Set());
    if (n.parentId && snapshot.nodes.has(n.parentId)) link(n.id, n.parentId);
  }
  for (const e of snapshot.edges.values()) {
    if (snapshot.nodes.has(e.sourceNodeId) && snapshot.nodes.has(e.targetNodeId)) link(e.sourceNodeId, e.targetNodeId);
  }
  return adj;
}

export interface Neighborhood {
  /** node id -> hop distance from the origin (origin = 0). */
  distance: Map<string, number>;
}

/** Breadth-first neighbourhood up to `maxHops` (1 = direct focus, 2 = extended focus). */
export function getNeighborhood(adj: ReadonlyMap<string, ReadonlySet<string>>, originId: string, maxHops: number): Neighborhood {
  const distance = new Map<string, number>([[originId, 0]]);
  let frontier = [originId];
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!distance.has(nb)) {
          distance.set(nb, hop);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return { distance };
}
