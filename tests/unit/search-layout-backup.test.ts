import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNodes } from '@/application/queries/search';
import { normalizeArabic } from '@/shared/utils/arabic';
import { computeFullLayout, LAYOUT } from '@/domain/graph/layout';
import { JsonBackupCodec } from '@/infrastructure/backup/jsonBackupCodec';
import { BackupService } from '@/application/services/backupService';
import { DexieRepository, OrbitalDatabase } from '@/infrastructure/database/dexieRepository';
import { GraphStore } from '@/application/services/graphStore';
import { MindCommands } from '@/application/commands/mindCommands';
import { makeApp, makeClock } from './helpers';

describe('Arabic search', () => {
  it('normalises hamza, taa marbuta and tashkeel', () => {
    expect(normalizeArabic('إدارةُ الأفكار')).toBe(normalizeArabic('اداره الافكار'));
    expect(normalizeArabic('٢٠٢٦')).toBe('2026');
  });
  it('ranks title prefix above description match', async () => {
    const { commands, store } = await makeApp();
    commands.createNode({ title: 'خطة السفر', description: 'تذاكر' });
    commands.createNode({ title: 'مكتبة', description: 'خطة القراءة' });
    const hits = searchNodes(store.getSnapshot(), 'خطه');
    expect(hits.map((h) => h.node.title)).toEqual(['خطة السفر', 'مكتبة']);
  });
});

describe('layout', () => {
  it('keeps every node outside the brain core and separated', async () => {
    const { commands, store } = await makeApp();
    const prim = Array.from({ length: 8 }, (_, i) => commands.createNode({ title: `رئيسية ${i}` }));
    for (const p of prim) for (let j = 0; j < 12; j++) commands.createNode({ title: `فرعية ${j}`, parentId: p.id });
    const pos = computeFullLayout(store.getSnapshot());
    expect(pos.size).toBe(8 + 96);
    for (const v of pos.values()) expect(Math.hypot(...v)).toBeGreaterThanOrEqual(LAYOUT.coreRadius - 1e-3);
    const all = [...pos.values()];
    let minD = Infinity;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) minD = Math.min(minD, Math.hypot(all[i][0] - all[j][0], all[i][1] - all[j][1], all[i][2] - all[j][2]));
    expect(minD).toBeGreaterThan(0.4);
  });
});

describe('backup codec', () => {
  it('round-trips export → import and migrates v1 documents', async () => {
    const { commands, store, repo } = await makeApp();
    const a = commands.createNode({ title: 'أ' });
    const b = commands.createNode({ title: 'ب', parentId: a.id });
    commands.connect(a.id, b.id, 'مرتبط');
    commands.addReminder(b.id, '2026-04-01T09:00:00Z', 'UTC', 'weekly');
    const codec = new JsonBackupCodec();
    const service = new BackupService(store, commands, repo, codec, makeClock(), () => 'bk');
    const json = service.exportJson();
    const preview = service.previewImport(json);
    expect(preview.ok && preview.preview.counts).toEqual({ nodes: 2, edges: 1, reminders: 1 });

    const v1 = JSON.parse(json);
    v1.schemaVersion = 1;
    for (const r of v1.reminders) { delete r.notificationState; r.notified = true; }
    for (const n of v1.nodes) delete n.deadline;
    const migrated = codec.decode(JSON.stringify(v1));
    expect(migrated.ok).toBe(true);
    if (migrated.ok) expect([...migrated.snapshot.reminders.values()][0].notificationState).toBe('notified');
  });

  it('rejects garbage and future versions, reports invalid records', () => {
    const codec = new JsonBackupCodec();
    expect(codec.decode('{nope')).toMatchObject({ ok: false, error: 'INVALID_JSON' });
    expect(codec.decode('{"foo":1}')).toMatchObject({ ok: false, error: 'NOT_A_BACKUP' });
    expect(codec.decode(JSON.stringify({ app: 'orbital-mind', schemaVersion: 99, nodes: [] }))).toMatchObject({ ok: false, error: 'UNSUPPORTED_VERSION' });
    const partial = codec.decode(JSON.stringify({ app: 'orbital-mind', schemaVersion: 2, nodes: [{ id: 'x', title: 'ok', position: [1, 2, 3], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, { id: 'y' }] }));
    expect(partial.ok && partial.issues).toEqual(['invalid-nodes:1']);
  });

  it('import stores a safety backup and is undoable', async () => {
    const { commands, store, repo } = await makeApp();
    commands.createNode({ title: 'قديم' });
    const service = new BackupService(store, commands, repo, new JsonBackupCodec(), makeClock(), () => 'bk1');
    const incoming = JSON.stringify({ app: 'orbital-mind', schemaVersion: 2, nodes: [{ id: 'n1', title: 'جديد', position: [9, 0, 0], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] });
    const p = service.previewImport(incoming);
    if (!p.ok) throw new Error('preview failed');
    await service.applyImport(p.preview);
    expect([...store.getSnapshot().nodes.values()].map((n) => n.title)).toEqual(['جديد']);
    expect(repo.backups).toHaveLength(1);
    store.undo();
    expect([...store.getSnapshot().nodes.values()].map((n) => n.title)).toEqual(['قديم']);
  });
});

describe('Dexie repository (fake-indexeddb)', () => {
  it('persists across re-open and quarantines malformed records', async () => {
    const name = `test-${Math.random()}`;
    const repo = await DexieRepository.open(name);
    const store = new GraphStore(repo);
    await store.init();
    const commands = new MindCommands(store, makeClock(), (() => { let i = 0; return () => `n${++i}`; })());
    commands.createNode({ title: 'دائم' });
    await store.flush();
    // Inject a corrupt row directly.
    const raw = new OrbitalDatabase(name);
    await raw.open();
    await raw.table('nodes').put({ id: 'bad', title: 42 });
    raw.close();

    const reopened = new GraphStore(await DexieRepository.open(name));
    const report = await reopened.init();
    expect([...reopened.getSnapshot().nodes.values()].map((n) => n.title)).toEqual(['دائم']);
    expect(report.quarantined).toBe(1);
    const check = new OrbitalDatabase(name);
    await check.open();
    expect(await check.table('quarantine').count()).toBe(1);
    expect(await check.table('nodes').count()).toBe(1);
  });
});
