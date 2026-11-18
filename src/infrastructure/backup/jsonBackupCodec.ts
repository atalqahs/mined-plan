import { z } from 'zod';
import type { BackupCodec, BackupDocument, DecodeResult } from '@/application/ports';
import type { GraphSnapshot, MindEdge, MindNode, MindReminder } from '@/domain/entities/types';
import { parseEdge, parseNode, parseReminder } from '../schemas';

export const BACKUP_SCHEMA_VERSION = 2;

const envelopeSchema = z.object({
  app: z.literal('orbital-mind'),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string().optional(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()).default([]),
  reminders: z.array(z.unknown()).default([]),
});

type Envelope = z.infer<typeof envelopeSchema>;

/**
 * Ordered migrations: migrations[v] upgrades a document from version v to v+1.
 * v1 → v2: reminders used `notified: boolean`; nodes had no `deadline`.
 */
const migrations: Record<number, (doc: Envelope) => Envelope> = {
  1: (doc) => ({
    ...doc,
    schemaVersion: 2,
    nodes: doc.nodes.map((n) => (isObj(n) ? { deadline: null, ...n } : n)),
    reminders: doc.reminders.map((r) => {
      if (!isObj(r)) return r;
      const { notified, ...rest } = r as Record<string, unknown> & { notified?: unknown };
      return { notificationState: notified === true ? 'notified' : 'pending', ...rest };
    }),
  }),
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function migrateDocument(doc: Envelope): Envelope {
  let cur = doc;
  while (cur.schemaVersion < BACKUP_SCHEMA_VERSION) {
    const step = migrations[cur.schemaVersion];
    if (!step) throw new Error(`missing migration from v${cur.schemaVersion}`);
    cur = step(cur);
  }
  return cur;
}

export class JsonBackupCodec implements BackupCodec {
  readonly currentVersion = BACKUP_SCHEMA_VERSION;

  encode(snapshot: GraphSnapshot, exportedAt: string): string {
    const doc: BackupDocument = {
      app: 'orbital-mind',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt,
      nodes: [...snapshot.nodes.values()],
      edges: [...snapshot.edges.values()],
      reminders: [...snapshot.reminders.values()],
    };
    return JSON.stringify(doc, null, 2);
  }

  decode(text: string): DecodeResult {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'INVALID_JSON', detail: (e as Error).message };
    }
    const env = envelopeSchema.safeParse(raw);
    if (!env.success) return { ok: false, error: 'NOT_A_BACKUP' };
    const sourceVersion = env.data.schemaVersion;
    if (sourceVersion > BACKUP_SCHEMA_VERSION) return { ok: false, error: 'UNSUPPORTED_VERSION', detail: String(sourceVersion) };

    let doc: Envelope;
    try {
      doc = migrateDocument(env.data);
    } catch (e) {
      return { ok: false, error: 'UNSUPPORTED_VERSION', detail: (e as Error).message };
    }

    const issues: string[] = [];
    const nodes = new Map<string, MindNode>();
    const edges = new Map<string, MindEdge>();
    const reminders = new Map<string, MindReminder>();
    let badNodes = 0, badEdges = 0, badReminders = 0;
    for (const n of doc.nodes) {
      const r = parseNode(n);
      if (r.success && !nodes.has(r.data.id)) nodes.set(r.data.id, r.data);
      else badNodes++;
    }
    for (const e of doc.edges) {
      const r = parseEdge(e);
      if (r.success && !edges.has(r.data.id)) edges.set(r.data.id, r.data);
      else badEdges++;
    }
    for (const rem of doc.reminders) {
      const r = parseReminder(rem);
      if (r.success && !reminders.has(r.data.id)) reminders.set(r.data.id, r.data);
      else badReminders++;
    }
    if (badNodes) issues.push(`invalid-nodes:${badNodes}`);
    if (badEdges) issues.push(`invalid-edges:${badEdges}`);
    if (badReminders) issues.push(`invalid-reminders:${badReminders}`);
    if (doc.nodes.length > 0 && nodes.size === 0) return { ok: false, error: 'SCHEMA_MISMATCH', detail: 'no valid nodes' };
    return { ok: true, snapshot: { nodes, edges, reminders }, sourceVersion, issues };
  }
}
