/**
 * Privacy-safe diagnostic log for the TV ⇄ phone link.
 *
 * Records only event names and small scalar facts (states, sizes, durations, counters).
 * The sanitizer drops anything that could carry private data: free text, idea titles,
 * descriptions, pairing codes, peer ids or tokens. Strings are accepted only as short
 * lowercase enum-like values ([a-z0-9-], ≤ 32 chars); keys must be short identifiers.
 * The log lives in memory (ring buffer) and is exported only when the user asks.
 */
export type DiagValue = number | boolean | string;
export interface DiagEntry {
  /** ms since this log was created */
  t: number;
  event: string;
  data?: Record<string, DiagValue>;
}

const EVENT_RE = /^[a-z][a-z0-9.-]{0,47}$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;
const ENUM_RE = /^[a-z0-9-]{0,32}$/;
/** Long hex-like runs could be ids, nonces or tokens. */
const ID_LIKE_RE = /[0-9a-f]{8,}/;
const CAPACITY = 500;

export class RemoteDiagnostics {
  private entries: DiagEntry[] = [];
  private readonly started = Date.now();
  private listeners = new Set<() => void>();

  log(event: string, data?: Record<string, unknown>): void {
    if (!EVENT_RE.test(event)) return;
    const entry: DiagEntry = { t: Date.now() - this.started, event };
    if (data) {
      const clean: Record<string, DiagValue> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!KEY_RE.test(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) clean[k] = Math.round(v * 100) / 100;
        else if (typeof v === 'boolean') clean[k] = v;
        else if (typeof v === 'string' && ENUM_RE.test(v) && !ID_LIKE_RE.test(v)) clean[k] = v;
        // anything else (free text, ids with uppercase/underscores, objects) is dropped
      }
      if (Object.keys(clean).length) entry.data = clean;
    }
    this.entries.push(entry);
    if (this.entries.length > CAPACITY) this.entries.splice(0, this.entries.length - CAPACITY);
    for (const l of this.listeners) l();
  }

  list(): readonly DiagEntry[] {
    return this.entries;
  }

  last(event: string): DiagEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].event === event) return this.entries[i];
    return undefined;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Plain-text export. `context` must itself be privacy-safe (it goes through the same sanitizer). */
  export(context: Record<string, unknown>): string {
    const header = new RemoteDiagnostics();
    header.log('context', context);
    const ctx = header.entries[0]?.data ?? {};
    const lines = [
      'ORBITAL MIND — TV link diagnostics (privacy-safe: no titles, notes, codes or ids)',
      `context ${JSON.stringify(ctx)}`,
      ...this.entries.map((e) => `+${(e.t / 1000).toFixed(2)}s ${e.event}${e.data ? ' ' + JSON.stringify(e.data) : ''}`),
    ];
    return lines.join('\n');
  }
}

/** One log per page (shared by transport, sessions and UI). */
export const remoteDiagnostics = new RemoteDiagnostics();
