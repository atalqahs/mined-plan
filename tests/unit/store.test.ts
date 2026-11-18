import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers';
import { GraphStore } from '@/application/services/graphStore';

describe('GraphStore', () => {
  it('persists, undoes and redoes through the repository', async () => {
    const { commands, store, repo } = await makeApp();
    const a = commands.createNode({ title: 'فكرة' });
    commands.updateNode(a.id, { title: 'فكرة معدلة', description: 'ملاحظات' });
    await store.flush();
    expect(repo.nodes.get(a.id)!.title).toBe('فكرة معدلة');
    expect(store.undo()).toBe('updateNode');
    await store.flush();
    expect(repo.nodes.get(a.id)!.title).toBe('فكرة');
    expect(store.undo()).toBe('createNode');
    await store.flush();
    expect(repo.nodes.size).toBe(0);
    expect(store.redo()).toBe('createNode');
    expect(store.redo()).toBe('updateNode');
    await store.flush();
    expect(repo.nodes.get(a.id)!.description).toBe('ملاحظات');
    // A new command clears the redo stack.
    store.undo();
    commands.createNode({ title: 'أخرى' });
    expect(store.canRedo()).toBe(false);
  });

  it('undo restores a cascade delete completely', async () => {
    const { commands, store } = await makeApp();
    const a = commands.createNode({ title: 'أ' });
    const b = commands.createNode({ title: 'ب', parentId: a.id });
    const c = commands.createNode({ title: 'ج' });
    commands.connect(b.id, c.id);
    commands.addReminder(b.id, '2026-05-01T08:00:00Z', 'Asia/Riyadh');
    const before = store.getSnapshot();
    commands.deleteNode(a.id, 'cascade');
    store.undo();
    const after = store.getSnapshot();
    const byId = (m: typeof before.nodes) => [...m.values()].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(after.nodes)).toEqual(byId(before.nodes));
    expect(after.edges.size).toBe(1);
    expect(after.reminders.size).toBe(1);
  });

  it('retries failed writes and survives a reload', async () => {
    const { commands, store, repo } = await makeApp();
    repo.failNextWrites = 1;
    commands.createNode({ title: 'مهم' });
    await new Promise((r) => setTimeout(r, 1100));
    await store.flush();
    expect(repo.nodes.size).toBe(1);
    const reloaded = new GraphStore(repo);
    await reloaded.init();
    expect([...reloaded.getSnapshot().nodes.values()][0].title).toBe('مهم');
  });

  it('ignores no-op edits in history', async () => {
    const { commands, store } = await makeApp();
    const a = commands.createNode({ title: 'ثابت' });
    commands.updateNode(a.id, { title: 'ثابت' });
    expect(store.peekUndoLabel()).toBe('createNode');
  });

  it('rejects empty titles', async () => {
    const { commands } = await makeApp();
    expect(() => commands.createNode({ title: '   ' })).toThrow(/TITLE_REQUIRED/);
  });
});
