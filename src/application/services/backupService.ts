import type { GraphSnapshot } from '@/domain/entities/types';
import { isCleanReport, repairSnapshot, type IntegrityReport } from '@/domain/graph/integrity';
import { migrateLayoutToCore } from '@/domain/graph/layout';
import type { MindCommands } from '../commands/mindCommands';
import type { BackupCodec, Clock, MindRepository, StoredBackup } from '../ports';
import type { GraphStore } from './graphStore';

export interface ImportPreview {
  snapshot: GraphSnapshot;
  counts: { nodes: number; edges: number; reminders: number };
  sourceVersion: number;
  issues: string[];
  integrity: IntegrityReport;
}

export type ImportPreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string; detail?: string };

const AUTO_BACKUPS_KEPT = 10;

/** Export / import orchestration. Before any destructive import, a safety backup is stored locally. */
export class BackupService {
  constructor(
    private readonly store: GraphStore,
    private readonly commands: MindCommands,
    private readonly repo: MindRepository,
    private readonly codec: BackupCodec,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {}

  exportJson(): string {
    return this.codec.encode(this.store.getSnapshot(), this.clock.now().toISOString());
  }

  /**
   * A backup of what is actually stored: waits for pending writes, then reads the
   * persisted records (not the in-memory view). Throws if writes are still failing,
   * so a backup never claims to contain changes that were not saved.
   */
  async exportPersistedJson(): Promise<string> {
    await this.store.flush();
    if (this.store.hasUnsavedChanges()) throw new Error('unsaved-changes');
    const r = await this.repo.loadAll();
    const snapshot = {
      nodes: new Map(r.nodes.map((n) => [n.id, n])),
      edges: new Map(r.edges.map((e) => [e.id, e])),
      reminders: new Map(r.reminders.map((x) => [x.id, x])),
    };
    return this.codec.encode(snapshot, this.clock.now().toISOString());
  }

  previewImport(text: string): ImportPreviewResult {
    const decoded = this.codec.decode(text);
    if (!decoded.ok) return { ok: false, error: decoded.error, detail: decoded.detail };
    const repaired = repairSnapshot(decoded.snapshot);
    const report = repaired.report;
    let snapshot = repaired.snapshot;
    const moved = migrateLayoutToCore(snapshot.nodes);
    if (moved.size) {
      const nodes = new Map(snapshot.nodes);
      for (const [id, position] of moved) nodes.set(id, { ...nodes.get(id)!, position });
      snapshot = { ...snapshot, nodes };
    }
    const issues = [...decoded.issues];
    if (!isCleanReport(report)) {
      if (report.orphanedNodes.length) issues.push(`orphans:${report.orphanedNodes.length}`);
      if (report.brokenCycles.length) issues.push(`cycles:${report.brokenCycles.length}`);
      if (report.danglingEdges.length + report.duplicateEdges.length) issues.push(`edges:${report.danglingEdges.length + report.duplicateEdges.length}`);
      if (report.danglingReminders.length) issues.push(`reminders:${report.danglingReminders.length}`);
    }
    return {
      ok: true,
      preview: {
        snapshot,
        counts: { nodes: snapshot.nodes.size, edges: snapshot.edges.size, reminders: snapshot.reminders.size },
        sourceVersion: decoded.sourceVersion,
        issues,
        integrity: report,
      },
    };
  }

  /** Replace current data with the imported snapshot, after storing a safety backup. */
  async applyImport(preview: ImportPreview): Promise<void> {
    await this.createSafetyBackup('before-import');
    this.commands.replaceAll(preview.snapshot, 'import');
    await this.store.flush();
  }

  async createSafetyBackup(reason: string): Promise<void> {
    if (this.store.getSnapshot().nodes.size === 0) return;
    const backup: StoredBackup = { id: this.newId(), createdAt: this.clock.now().toISOString(), reason, json: this.exportJson() };
    await this.repo.saveBackup(backup, AUTO_BACKUPS_KEPT);
  }

  listBackups(): Promise<StoredBackup[]> {
    return this.repo.listBackups();
  }
}
