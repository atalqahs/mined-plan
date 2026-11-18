import type { GraphSnapshot, MindEdge, MindNode } from '@/domain/entities/types';

export interface RelatedItem {
  edge: MindEdge;
  other: MindNode;
  direction: 'out' | 'in';
}

export function childrenOf(snapshot: GraphSnapshot, id: string): MindNode[] {
  const out: MindNode[] = [];
  for (const n of snapshot.nodes.values()) if (n.parentId === id) out.push(n);
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function relatedOf(snapshot: GraphSnapshot, id: string): RelatedItem[] {
  const out: RelatedItem[] = [];
  for (const e of snapshot.edges.values()) {
    if (e.sourceNodeId === id) {
      const other = snapshot.nodes.get(e.targetNodeId);
      if (other) out.push({ edge: e, other, direction: 'out' });
    } else if (e.targetNodeId === id) {
      const other = snapshot.nodes.get(e.sourceNodeId);
      if (other) out.push({ edge: e, other, direction: 'in' });
    }
  }
  return out;
}
