import Dexie, { type Table } from 'dexie';
import type { MindEdge, MindNode, MindReminder } from '@/domain/entities/types';
import type { LoadResult, MindRepository, QuarantinedRecord, StoredBackup } from '@/application/ports';
import type { Patch } from '@/application/patch';
import { describeZodError, parseEdge, parseNode, parseReminder } from '../schemas';

interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * IndexedDB schema. Bump the version and add an `.upgrade()` for every change —
 * never edit a published version. See docs/ARCHITECTURE.md → "Storage migrations".
 */
export class OrbitalDatabase extends Dexie {
  nodes!: Table<MindNode, string>;
  edges!: Table<MindEdge, string>;
  reminders!: Table<MindReminder, string>;
  quarantine!: Table<QuarantinedRecord, string>;
  backups!: Table<StoredBackup, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'orbital-mind') {
    super(name);
    // v1 — initial schema.
    this.version(1).stores({
      nodes: 'id, parentId, updatedAt',
      edges: 'id, sourceNodeId, targetNodeId',
      reminders: 'id, nodeId, dueAt',
      meta: 'key',
    });
    // v2 — adds quarantine + local safety backups; normalises reminder delivery state.
    this.version(2)
      .stores({
        nodes: 'id, parentId, updatedAt',
        edges: 'id, sourceNodeId, targetNodeId',
        reminders: 'id, nodeId, dueAt, completed',
        quarantine: 'id, table, quarantinedAt',
        backups: 'id, createdAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('reminders')
          .toCollection()
          .modify((r: Record<string, unknown>) => {
            if (typeof r.notificationState !== 'string') r.notificationState = 'pending';
            if (typeof r.completed !== 'boolean') r.completed = false;
          });
      });
  }
}

export class DexieRepository implements MindRepository {
  readonly kind = 'indexeddb' as const;

  constructor(private readonly db: OrbitalDatabase = new OrbitalDatabase()) {}

  static async open(name?: string): Promise<DexieRepository> {
    const db = new OrbitalDatabase(name);
    await db.open();
    return new DexieRepository(db);
  }

  async loadAll(): Promise<LoadResult> {
    return this.db.transaction('r', this.db.nodes, this.db.edges, this.db.reminders, async () => {
      const [rawNodes, rawEdges, rawReminders] = await Promise.all([this.db.nodes.toArray(), this.db.edges.toArray(), this.db.reminders.toArray()]);
      const result: LoadResult = { nodes: [], edges: [], reminders: [], invalid: [] };
      const now = new Date().toISOString();
      const bad = (table: QuarantinedRecord['table'], raw: unknown, reason: string): QuarantinedRecord => ({
        id: `${table}:${(raw as { id?: string })?.id ?? Math.random().toString(36).slice(2)}`,
        table,
        reason,
        payload: raw,
        quarantinedAt: now,
      });
      for (const raw of rawNodes) {
        const r = parseNode(raw);
        if (r.success) result.nodes.push(r.data);
        else result.invalid.push(bad('nodes', raw, describeZodError(r.error)));
      }
      for (const raw of rawEdges) {
        const r = parseEdge(raw);
        if (r.success) result.edges.push(r.data);
        else result.invalid.push(bad('edges', raw, describeZodError(r.error)));
      }
      for (const raw of rawReminders) {
        const r = parseReminder(raw);
        if (r.success) result.reminders.push(r.data);
        else result.invalid.push(bad('reminders', raw, describeZodError(r.error)));
      }
      return result;
    });
  }

  async applyPatch(p: Patch): Promise<void> {
    await this.db.transaction('rw', this.db.nodes, this.db.edges, this.db.reminders, async () => {
      if (p.nodes.del.length) await this.db.nodes.bulkDelete(p.nodes.del);
      if (p.edges.del.length) await this.db.edges.bulkDelete(p.edges.del);
      if (p.reminders.del.length) await this.db.reminders.bulkDelete(p.reminders.del);
      if (p.nodes.put.length) await this.db.nodes.bulkPut(p.nodes.put);
      if (p.edges.put.length) await this.db.edges.bulkPut(p.edges.put);
      if (p.reminders.put.length) await this.db.reminders.bulkPut(p.reminders.put);
    });
  }

  /** Move invalid records out of the live tables — preserved for manual recovery. */
  async quarantine(records: QuarantinedRecord[]): Promise<void> {
    await this.db.transaction('rw', [this.db.quarantine, this.db.nodes, this.db.edges, this.db.reminders], async () => {
      await this.db.quarantine.bulkPut(records);
      for (const rec of records) {
        const rawId = (rec.payload as { id?: unknown })?.id;
        if (typeof rawId === 'string') await this.db.table(rec.table).delete(rawId);
      }
    });
  }

  async saveBackup(backup: StoredBackup, keep: number): Promise<void> {
    await this.db.transaction('rw', this.db.backups, async () => {
      await this.db.backups.put(backup);
      const all = await this.db.backups.orderBy('createdAt').reverse().primaryKeys();
      if (all.length > keep) await this.db.backups.bulkDelete(all.slice(keep));
    });
  }

  listBackups(): Promise<StoredBackup[]> {
    return this.db.backups.orderBy('createdAt').reverse().toArray();
  }
}
