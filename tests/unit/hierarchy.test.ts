import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers';
import { getDescendantIds, wouldCreateCycle } from '@/domain/graph/hierarchy';
import { buildAdjacency, getNeighborhood } from '@/domain/graph/neighborhood';
import { repairSnapshot } from '@/domain/graph/integrity';
import { DomainError } from '@/domain/rules/errors';

describe('hierarchy rules', () => {
  it('prevents parent-child cycles but allows cyclic cross-connections', async () => {
    const { commands, store } = await makeApp();
    const a = commands.createNode({ title: 'أ' });
    const b = commands.createNode({ title: 'ب', parentId: a.id });
    const c = commands.createNode({ title: 'ج', parentId: b.id });
    expect(wouldCreateCycle(store.getSnapshot().nodes, a.id, c.id)).toBe(true);
    expect(() => commands.moveNode(a.id, c.id)).toThrow(DomainError);
    expect(() => commands.moveNode(a.id, a.id)).toThrow(DomainError);
    // Cross-connections may form cycles.
    commands.connect(a.id, b.id);
    commands.connect(b.id, c.id);
    commands.connect(c.id, a.id);
    expect(store.getSnapshot().edges.size).toBe(3);
    expect(() => commands.connect(b.id, a.id)).toThrow(/EDGE_DUPLICATE/);
    expect(() => commands.connect(a.id, a.id)).toThrow(/EDGE_SELF_LOOP/);
  });

  it('keeps cross-connections intact when a node is re-parented', async () => {
    const { commands, store } = await makeApp();
    const a = commands.createNode({ title: 'أ' });
    const b = commands.createNode({ title: 'ب' });
    const c = commands.createNode({ title: 'ج', parentId: a.id });
    const x = commands.createNode({ title: 'س', parentId: c.id });
    const edge = commands.connect(c.id, b.id, 'يدعم');
    commands.moveNode(c.id, b.id);
    const s = store.getSnapshot();
    expect(s.nodes.get(c.id)!.parentId).toBe(b.id);
    expect(s.nodes.get(x.id)!.parentId).toBe(c.id);
    expect(s.edges.get(edge)).toMatchObject({ sourceNodeId: c.id, targetNodeId: b.id, relationType: 'يدعم' });
    expect(getDescendantIds(s.nodes, b.id).sort()).toEqual([c.id, x.id].sort());
  });

  it('delete cascade removes subtree, edges and reminders; promote keeps children', async () => {
    const { commands, store } = await makeApp();
    const root = commands.createNode({ title: 'جذر' });
    const mid = commands.createNode({ title: 'وسط', parentId: root.id });
    const leaf = commands.createNode({ title: 'ورقة', parentId: mid.id });
    const other = commands.createNode({ title: 'آخر' });
    commands.connect(leaf.id, other.id);
    commands.addReminder(leaf.id, '2026-04-01T10:00:00Z', 'UTC');
    commands.deleteNode(mid.id, 'promoteChildren');
    expect(store.getSnapshot().nodes.get(leaf.id)!.parentId).toBe(root.id);
    commands.deleteNode(root.id, 'cascade');
    const s = store.getSnapshot();
    expect([...s.nodes.keys()]).toEqual([other.id]);
    expect(s.edges.size).toBe(0);
    expect(s.reminders.size).toBe(0);
  });
});

describe('neighbourhood (focus mode)', () => {
  it('uses both hierarchy and cross edges for 1 and 2 hops', async () => {
    const { commands, store } = await makeApp();
    const a = commands.createNode({ title: 'أ' });
    const b = commands.createNode({ title: 'ب', parentId: a.id });
    const c = commands.createNode({ title: 'ج', parentId: b.id });
    const d = commands.createNode({ title: 'د' });
    const e = commands.createNode({ title: 'هـ' });
    commands.connect(b.id, d.id);
    const adj = buildAdjacency(store.getSnapshot());
    const one = getNeighborhood(adj, b.id, 1).distance;
    expect([...one.keys()].sort()).toEqual([a.id, b.id, c.id, d.id].sort());
    const two = getNeighborhood(adj, c.id, 2).distance;
    expect(two.get(b.id)).toBe(1);
    expect(two.get(a.id)).toBe(2);
    expect(two.get(d.id)).toBe(2);
    expect(two.has(e.id)).toBe(false);
  });
});

describe('integrity repair', () => {
  it('re-attaches orphans, breaks cycles and reports dangling refs without deleting nodes', () => {
    const n = (id: string, parentId: string | null) => ({ id, title: id, description: '', parentId, category: '', position: [0, 0, 0] as [number, number, number], status: 'active' as const, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const nodes = new Map([['a', n('a', 'b')], ['b', n('b', 'a')], ['c', n('c', 'missing')]]);
    const edges = new Map([['e1', { id: 'e1', sourceNodeId: 'a', targetNodeId: 'zzz', relationType: '', createdAt: '2026-01-01T00:00:00Z' }]]);
    const { snapshot, report } = repairSnapshot({ nodes, edges, reminders: new Map() });
    expect(snapshot.nodes.size).toBe(3);
    expect(report.orphanedNodes).toEqual(['c']);
    expect(report.brokenCycles.length).toBe(1);
    expect(report.danglingEdges.map((e) => e.id)).toEqual(['e1']);
  });
});

describe('layout migration to the enlarged brain', () => {
  it('moves legacy layouts outward once, preserving direction and order', async () => {
    const { migrateLayoutToCore, LAYOUT } = await import('@/domain/graph/layout');
    const n = (id: string, position: [number, number, number]) => ({ id, title: id, description: '', parentId: null, category: '', position, status: 'active' as const, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const legacy = new Map([['a', n('a', [4.4, 0, 0])], ['b', n('b', [0, 10.5, 0])], ['c', n('c', [0, 0, -13])]]);
    const moved = migrateLayoutToCore(legacy);
    expect(moved.get('a')).toEqual([LAYOUT.coreRadius, 0, 0]);
    expect(moved.get('b')![1]).toBeCloseTo(10.5 + (LAYOUT.coreRadius - 4.4), 3); // shifted, not compressed
    expect(moved.get('c')![2]).toBeCloseTo(-(13 + LAYOUT.coreRadius - 4.4), 3); // farther stays farther
    // Already-migrated layouts are left alone.
    const current = new Map([...moved].map(([id, p]) => [id, n(id, p)]));
    expect(migrateLayoutToCore(current).size).toBe(0);
  });

  it('GraphStore persists the migration on load', async () => {
    const { MemoryRepository } = await import('@/infrastructure/database/memoryRepository');
    const { GraphStore } = await import('@/application/services/graphStore');
    const repo = new MemoryRepository();
    repo.nodes.set('x', { id: 'x', title: 'قديم', description: '', parentId: null, category: '', position: [5, 0, 0], status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const store = new GraphStore(repo);
    await store.init();
    await store.flush();
    expect(Math.hypot(...repo.nodes.get('x')!.position)).toBeGreaterThanOrEqual(6.4);
    expect(store.canUndo()).toBe(false);
  });
});
