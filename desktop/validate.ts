import { JsonBackupCodec } from '@/infrastructure/backup/jsonBackupCodec';
import type { Validation } from './backupStore';

const codec = new JsonBackupCodec();

/**
 * A backup is accepted only if the app's own importer would load every record in it
 * (same codec as "استيراد JSON"): no invalid nodes, links or reminders.
 */
export function validateBackupText(text: string): Validation {
  const r = codec.decode(text);
  if (!r.ok) return { ok: false, reason: r.error.toLowerCase() };
  if (r.issues.length) return { ok: false, reason: 'invalid-records' };
  return { ok: true, nodes: r.snapshot.nodes.size, edges: r.snapshot.edges.size, reminders: r.snapshot.reminders.size };
}
