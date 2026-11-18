import { EMPTY_SNAPSHOT, type GraphSnapshot } from '@/domain/entities/types';
import { repairSnapshot, type IntegrityReport } from '@/domain/graph/integrity';
import { applyPatch, invertPatch, isEmptyPatch, type Patch } from '../patch';
import type { MindRepository, QuarantinedRecord } from '../ports';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface HistoryEntry {
  label: string;
  mergeKey?: string;
  at?: number;
  /** Patch that performs this history move when applied to the current state. */
  apply: Patch;
}

export interface CommitOptions {
  /** Record on the undo stack (default true). System bookkeeping passes false. */
  undoable?: boolean;
  /**
   * Coalesce with the previous history entry if it has the same key and was made
   * within COALESCE_MS (e.g. continuous typing in one note = one undo step).
   */
  mergeKey?: string;
}

export interface InitReport {
  integrity: IntegrityReport;
  quarantined: number;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 4000;

/**
 * Single source of truth for the mind graph at runtime.
 *  - Holds an immutable snapshot (structural sharing) for cheap subscriptions.
 *  - Applies every change optimistically, then persists through the repository
 *    in strict order. Failed writes are retried; nothing is dropped.
 *  - Maintains undo/redo as inverse patches.
 * Framework-agnostic: React binds via useSyncExternalStore.
 */
export class GraphStore {
  private snapshot: GraphSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private statusListeners = new Set<(s: SaveStatus) => void>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private pending: Patch[] = [];
  private flushing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  private _status: SaveStatus = 'idle';
  private _version = 0;

  constructor(private readonly repo: MindRepository) {}

  get repositoryKind() {
    return this.repo.kind;
  }

  async init(): Promise<InitReport> {
    const loaded = await this.repo.loadAll();
    const raw: GraphSnapshot = {
      nodes: new Map(loaded.nodes.map((n) => [n.id, n])),
      edges: new Map(loaded.edges.map((e) => [e.id, e])),
      reminders: new Map(loaded.reminders.map((r) => [r.id, r])),
    };
    const { snapshot, report } = repairSnapshot(raw);
    const quarantine: QuarantinedRecord[] = [...loaded.invalid];
    const now = new Date().toISOString();
    for (const e of [...report.danglingEdges, ...report.duplicateEdges])
      quarantine.push({ id: e.id, table: 'edges', reason: 'dangling-or-duplicate', payload: e, quarantinedAt: now });
    for (const r of report.danglingReminders) quarantine.push({ id: r.id, table: 'reminders', reason: 'dangling', payload: r, quarantinedAt: now });
    if (quarantine.length) await this.repo.quarantine(quarantine);

    // Persist structural repairs (re-parented orphans / broken cycles).
    const repaired = [...report.orphanedNodes, ...report.brokenCycles].map((id) => snapshot.nodes.get(id)!);
    this.snapshot = snapshot;
    if (repaired.length) this.enqueue({ nodes: { put: repaired, del: [] }, edges: { put: [], del: [] }, reminders: { put: [], del: [] } });
    this.emit();
    return { integrity: report, quarantined: quarantine.length };
  }

  /** Replace in-memory state without persistence (benchmarks / demos). */
  hydrateEphemeral(snapshot: GraphSnapshot) {
    this.snapshot = snapshot;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  getSnapshot = (): GraphSnapshot => this.snapshot;

  /** Monotonic counter, bumps on every change. */
  get version() {
    return this._version;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get status(): SaveStatus {
    return this._status;
  }

  onStatus(listener: (s: SaveStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  commit(label: string, patch: Patch, options: CommitOptions = {}): void {
    if (isEmptyPatch(patch)) return;
    const inverse = invertPatch(this.snapshot, patch);
    this.snapshot = applyPatch(this.snapshot, patch);
    if (options.undoable !== false) {
      const top = this.undoStack.at(-1);
      const now = Date.now();
      if (options.mergeKey && top?.mergeKey === options.mergeKey && now - (top.at ?? 0) < COALESCE_MS && !this.redoStack.length) {
        // Keep the older inverse (restores the state before the first edit); extend for any new ids.
        top.at = now;
        mergeInverse(top.apply, inverse);
        this.enqueue(patch);
        this.emit();
        return;
      }
      this.undoStack.push({ label, apply: inverse, mergeKey: options.mergeKey, at: now });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.enqueue(patch);
    this.emit();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  peekUndoLabel() {
    return this.undoStack.at(-1)?.label ?? null;
  }
  peekRedoLabel() {
    return this.redoStack.at(-1)?.label ?? null;
  }

  undo(): string | null {
    return this.travel(this.undoStack, this.redoStack);
  }

  redo(): string | null {
    return this.travel(this.redoStack, this.undoStack);
  }

  private travel(from: HistoryEntry[], to: HistoryEntry[]): string | null {
    const entry = from.pop();
    if (!entry) return null;
    const reverse = invertPatch(this.snapshot, entry.apply);
    this.snapshot = applyPatch(this.snapshot, entry.apply);
    to.push({ label: entry.label, apply: reverse });
    this.enqueue(entry.apply);
    this.emit();
    return entry.label;
  }

  /** Resolves once every queued write has reached storage (or failed and is scheduled for retry). */
  async flush(): Promise<void> {
    while (this.flushing) await this.flushing;
  }

  hasUnsavedChanges(): boolean {
    return this.pending.length > 0 || this.flushing !== null;
  }

  private enqueue(patch: Patch) {
    this.pending.push(patch);
    this.kick();
  }

  private kick() {
    if (this.flushing || this.retryTimer) return;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
  }

  private async drain() {
    this.setStatus('saving');
    while (this.pending.length) {
      const next = this.pending[0];
      try {
        await this.repo.applyPatch(next);
        this.pending.shift();
        this.retryDelay = 1000;
      } catch (error) {
        console.error('[GraphStore] persistence failed; will retry', error);
        this.setStatus('error');
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.kick();
        }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
        return;
      }
    }
    this.setStatus('saved');
  }

  private setStatus(s: SaveStatus) {
    if (s === this._status) return;
    this._status = s;
    for (const l of this.statusListeners) l(s);
  }

  private emit() {
    this._version++;
    for (const l of this.listeners) l();
  }
}

/** Add entries from `later` for ids not already covered by `base` (base wins: it is older). */
function mergeInverse(base: Patch, later: Patch) {
  for (const table of ['nodes', 'edges', 'reminders'] as const) {
    const b = base[table] as { put: Array<{ id: string }>; del: string[] };
    const l = later[table] as { put: Array<{ id: string }>; del: string[] };
    const seen = new Set([...b.put.map((x) => x.id), ...b.del]);
    for (const x of l.put) if (!seen.has(x.id)) b.put.push(x);
    for (const id of l.del) if (!seen.has(id)) b.del.push(id);
  }
}
