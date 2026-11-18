/**
 * Wire protocol between the phone controller and the TV presentation.
 * All inbound messages are untrusted: `parse*Message` validates shape and bounds and
 * returns null for anything unexpected. Messages are small JSON objects; the graph
 * snapshot is sent as ordered chunks (see graphShare.ts).
 */
import type { DeviceKind } from './types';

export type FocusLevelWire = 1 | 2;

/** Phone → TV, before authentication. */
export type HelloMessage = { t: 'hello'; v: number; device: DeviceKind };
export type AuthMessage = { t: 'auth'; proof: string };

/** Phone → TV, after approval. Each carries a strictly increasing `seq`. */
export type ControlCommand =
  | { t: 'orbit'; az: number; pol: number }
  | { t: 'zoom'; factor: number }
  | { t: 'reset' }
  | { t: 'select'; id: string | null }
  | { t: 'focus'; on: boolean; level?: FocusLevelWire }
  | { t: 'primaryOnly'; on: boolean }
  | { t: 'toolbar'; visible: boolean }
  | { t: 'exitTv' }
  | { t: 'graph-chunk'; gid: string; i: number; n: number; data: string }
  | { t: 'graph-stop' }
  | { t: 'bye' };

export type SequencedCommand = ControlCommand & { seq: number };

/** TV → phone. */
export type TvMessage =
  | { t: 'challenge'; v: number; nonce: string }
  | { t: 'auth-fail'; reason: 'bad-proof' | 'expired' | 'timeout' | 'version' }
  | { t: 'pending' }
  | { t: 'approved' }
  | { t: 'rejected' }
  | { t: 'busy' }
  | { t: 'state'; selectedId: string | null; focus: boolean; level: FocusLevelWire; primaryOnly: boolean; toolbar: boolean; source: 'local' | 'phone' }
  | { t: 'index'; nodes: Array<{ id: string; title: string; parentId: string | null }> }
  | { t: 'ended'; reason: 'exit' | 'disconnect' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const DEVICES = ['iphone', 'ipad', 'android', 'mac', 'windows', 'other'];

export const MAX_CHUNK_CHARS = 16_000;
export const MAX_CHUNKS = 400; // ~6.4 MB of JSON — far above a 5,000-idea network

export function parsePreAuthMessage(raw: unknown): HelloMessage | AuthMessage | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'hello' && isNum(raw.v, 0, 1000) && isStr(raw.device, 16) && DEVICES.includes(raw.device)) return { t: 'hello', v: raw.v, device: raw.device as DeviceKind };
  if (raw.t === 'auth' && isStr(raw.proof, 64)) return { t: 'auth', proof: raw.proof };
  return null;
}

export function parseCommand(raw: unknown): SequencedCommand | null {
  if (!isObj(raw) || typeof raw.seq !== 'number') return null;
  const seq = raw.seq;
  switch (raw.t) {
    case 'orbit':
      return isNum(raw.az, -Math.PI, Math.PI) && isNum(raw.pol, -Math.PI, Math.PI) ? { t: 'orbit', az: raw.az, pol: raw.pol, seq } : null;
    case 'zoom':
      return isNum(raw.factor, 0.2, 5) ? { t: 'zoom', factor: raw.factor, seq } : null;
    case 'reset':
    case 'exitTv':
    case 'graph-stop':
    case 'bye':
      return { t: raw.t, seq };
    case 'select':
      return raw.id === null || isStr(raw.id, 128) ? { t: 'select', id: raw.id as string | null, seq } : null;
    case 'focus':
      if (typeof raw.on !== 'boolean') return null;
      if (raw.level !== undefined && raw.level !== 1 && raw.level !== 2) return null;
      return { t: 'focus', on: raw.on, ...(raw.level ? { level: raw.level as FocusLevelWire } : {}), seq };
    case 'primaryOnly':
      return typeof raw.on === 'boolean' ? { t: 'primaryOnly', on: raw.on, seq } : null;
    case 'toolbar':
      return typeof raw.visible === 'boolean' ? { t: 'toolbar', visible: raw.visible, seq } : null;
    case 'graph-chunk':
      return isStr(raw.gid, 64) && isNum(raw.n, 1, MAX_CHUNKS) && isNum(raw.i, 0, MAX_CHUNKS - 1) && Number.isInteger(raw.i) && Number.isInteger(raw.n) && isStr(raw.data, MAX_CHUNK_CHARS)
        ? { t: 'graph-chunk', gid: raw.gid, i: raw.i, n: raw.n, data: raw.data, seq }
        : null;
    default:
      return null;
  }
}

export function parseTvMessage(raw: unknown): TvMessage | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'challenge':
      return isNum(raw.v, 0, 1000) && isStr(raw.nonce, 64) ? { t: 'challenge', v: raw.v, nonce: raw.nonce } : null;
    case 'auth-fail':
      return ['bad-proof', 'expired', 'timeout', 'version'].includes(raw.reason as string) ? { t: 'auth-fail', reason: raw.reason as 'bad-proof' } : null;
    case 'pending':
    case 'approved':
    case 'rejected':
    case 'busy':
      return { t: raw.t };
    case 'ended':
      return raw.reason === 'exit' || raw.reason === 'disconnect' ? { t: 'ended', reason: raw.reason } : null;
    case 'state':
      if ((raw.selectedId !== null && !isStr(raw.selectedId, 128)) || typeof raw.focus !== 'boolean' || (raw.level !== 1 && raw.level !== 2) || typeof raw.primaryOnly !== 'boolean' || typeof raw.toolbar !== 'boolean' || (raw.source !== 'local' && raw.source !== 'phone')) return null;
      return { t: 'state', selectedId: raw.selectedId as string | null, focus: raw.focus, level: raw.level, primaryOnly: raw.primaryOnly, toolbar: raw.toolbar, source: raw.source };
    case 'index': {
      if (!Array.isArray(raw.nodes) || raw.nodes.length > 5000) return null;
      const nodes: Array<{ id: string; title: string; parentId: string | null }> = [];
      for (const n of raw.nodes) {
        if (!isObj(n) || !isStr(n.id, 128) || !isStr(n.title, 120) || (n.parentId !== null && !isStr(n.parentId, 128))) return null;
        nodes.push({ id: n.id, title: n.title, parentId: n.parentId as string | null });
      }
      return { t: 'index', nodes };
    }
    default:
      return null;
  }
}
