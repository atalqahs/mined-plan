import type { GraphSnapshot, MindEdge, MindNode, MindReminder } from '@/domain/entities/types';
import type { Patch } from '../patch';

/** Records that failed validation on load. Kept, never discarded. */
export interface QuarantinedRecord {
  id: string;
  table: 'nodes' | 'edges' | 'reminders';
  reason: string;
  payload: unknown;
  quarantinedAt: string;
}

export interface LoadResult {
  nodes: MindNode[];
  edges: MindEdge[];
  reminders: MindReminder[];
  invalid: QuarantinedRecord[];
}

export interface StoredBackup {
  id: string;
  createdAt: string;
  reason: string;
  json: string;
}

/** Persistence port. Implementations: Dexie/IndexedDB, in-memory. */
export interface MindRepository {
  readonly kind: 'indexeddb' | 'memory';
  loadAll(): Promise<LoadResult>;
  applyPatch(patch: Patch): Promise<void>;
  quarantine(records: QuarantinedRecord[]): Promise<void>;
  saveBackup(backup: StoredBackup, keep: number): Promise<void>;
  listBackups(): Promise<StoredBackup[]>;
}

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface NotificationMessage {
  title: string;
  body: string;
  tag: string;
  onClick?: () => void;
}

/** Notification delivery port. */
export interface Notifier {
  permission(): NotificationPermissionState;
  requestPermission(): Promise<NotificationPermissionState>;
  notify(message: NotificationMessage): boolean;
}

export interface Clock {
  now(): Date;
}

export interface BackupDocument {
  app: 'orbital-mind';
  schemaVersion: number;
  exportedAt: string;
  nodes: MindNode[];
  edges: MindEdge[];
  reminders: MindReminder[];
}

export type DecodeResult =
  | { ok: true; snapshot: GraphSnapshot; sourceVersion: number; issues: string[] }
  | { ok: false; error: 'INVALID_JSON' | 'NOT_A_BACKUP' | 'UNSUPPORTED_VERSION' | 'SCHEMA_MISMATCH'; detail?: string };

/** Serialisation + validation of portable backups. */
export interface BackupCodec {
  readonly currentVersion: number;
  encode(snapshot: GraphSnapshot, exportedAt: string): string;
  decode(text: string): DecodeResult;
}
