import type { MindNode } from '../entities/types';
import { DomainError } from '../rules/errors';

type NodeMap = ReadonlyMap<string, MindNode>;

/** Map parentId -> child ids (null key = primary ideas). Stable insertion (createdAt) order. */
export function buildChildIndex(nodes: NodeMap): Map<string | null, string[]> {
  const index = new Map<string | null, string[]>();
  const sorted = [...nodes.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );
  for (const n of sorted) {
    const key = n.parentId && nodes.has(n.parentId) ? n.parentId : null;
    let list = index.get(key);
    if (!list) index.set(key, (list = []));
    list.push(n.id);
  }
  return index;
}

/** All descendant ids of `rootId` (excluding the root). Iterative, cycle-safe. */
export function getDescendantIds(nodes: NodeMap, rootId: string, childIndex = buildChildIndex(nodes)): string[] {
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const stack = [...(childIndex.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const kids = childIndex.get(id);
    if (kids) stack.push(...kids);
  }
  return out;
}

/** Chain of ancestors from the direct parent up to the root primary idea. */
export function getAncestorIds(nodes: NodeMap, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = nodes.get(id)?.parentId ?? null;
  while (cur && nodes.has(cur) && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = nodes.get(cur)!.parentId;
  }
  return out;
}

export function getDepth(nodes: NodeMap, id: string): number {
  return getAncestorIds(nodes, id).length;
}

/** True when making `newParentId` the parent of `nodeId` would create a hierarchy cycle. */
export function wouldCreateCycle(nodes: NodeMap, nodeId: string, newParentId: string | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === nodeId) return true;
  return getAncestorIds(nodes, newParentId).includes(nodeId);
}

export function assertValidParent(nodes: NodeMap, nodeId: string, newParentId: string | null): void {
  if (newParentId === null) return;
  if (newParentId === nodeId) throw new DomainError('SELF_PARENT');
  if (!nodes.has(newParentId)) throw new DomainError('PARENT_NOT_FOUND', newParentId);
  if (wouldCreateCycle(nodes, nodeId, newParentId)) throw new DomainError('HIERARCHY_CYCLE');
}
