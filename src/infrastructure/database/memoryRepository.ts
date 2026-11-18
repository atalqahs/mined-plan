import type { MindEdge, MindNode, MindReminder } from '@/domain/entities/types';
import type { LoadResult, MindRepository, QuarantinedRecord, StoredBackup } from '@/application/ports';
import type { Patch } from '@/application/patch';

/**
 * Non-persistent repository. Used in tests, benchmarks, and as a fallback when
 * IndexedDB is unavailable (the UI then warns that data will not survive reload).
 */
export class MemoryRepository implements MindRepository {
  readonly kind = 'memory' as const;
  nodes = new Map<string, MindNode>();
  edges = new Map<string, MindEdge>();
  reminders = new Map<string, MindReminder>();
  quarantined: QuarantinedRecord[] = [];
  backups: StoredBackup[] = [];
  /** Test hook: make the next N writes fail. */
  failNextWrites = 0;

  async loadAll(): Promise<LoadResult> {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()], reminders: [...this.reminders.values()], invalid: [] };
  }

  async applyPatch(p: Patch): Promise<void> {
    if (this.failNextWrites > 0) {
      this.failNextWrites--;
      throw new Error('simulated write failure');
    }
    for (const id of p.nodes.del) this.nodes.delete(id);
    for (const id of p.edges.del) this.edges.delete(id);
    for (const id of p.reminders.del) this.reminders.delete(id);
    for (const n of p.nodes.put) this.nodes.set(n.id, structuredClone(n));
    for (const e of p.edges.put) this.edges.set(e.id, structuredClone(e));
    for (const r of p.reminders.put) this.reminders.set(r.id, structuredClone(r));
  }

  async quarantine(records: QuarantinedRecord[]): Promise<void> {
    this.quarantined.push(...records);
  }

  async saveBackup(backup: StoredBackup, keep: number): Promise<void> {
    this.backups = [backup, ...this.backups].slice(0, keep);
  }

  async listBackups(): Promise<StoredBackup[]> {
    return [...this.backups];
  }
}
