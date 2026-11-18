/**
 * Wire protocol (v2) between the phone controller and the TV presentation.
 * All inbound messages are untrusted: `parse*` validates shape and bounds and returns
 * null for anything unexpected. Every frame is JSON ≤ MAX_FRAME_BYTES UTF-8 bytes.
 *
 * Handshake: phone → hello{resume?} · TV → challenge(nonce) · phone → auth(HMAC proof)
 *            TV → pending → (owner) approved{resume token} | rejected
 *            (a valid resume token from the same approved session skips the prompt)
 * Liveness:  TV → ping{n} every few seconds · phone → pong{n}
 * Graph:     phone → graph-begin · graph-part × n (paced, ≤ window unacknowledged)
 *            TV → graph-ack(i) per part · graph-done{counts} after validation | graph-error
 */
import type { GraphPart } from './graphShare';
import type { DeviceKind } from './types';

export type FocusLevelWire = 1 | 2;

/** Phone → TV, before authentication. */
export type HelloMessage = { t: 'hello'; v: number; device: DeviceKind; resume?: string };
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
  | { t: 'pong'; n: number }
  | { t: 'graph-begin'; gid: string; parts: number; nodes: number; edges: number }
  | ({ t: 'graph-part'; gid: string; i: number } & GraphPart)
  | { t: 'graph-abort'; gid: string }
  | { t: 'graph-stop' }
  | { t: 'bye' };

export type SequencedCommand = ControlCommand & { seq: number };

export type GraphErrorReason = 'invalid' | 'too-large' | 'unexpected' | 'mismatch';

/** TV → phone. */
export type TvMessage =
  | { t: 'challenge'; v: number; nonce: string }
  | { t: 'auth-fail'; reason: 'bad-proof' | 'expired' | 'timeout' | 'version' }
  | { t: 'pending' }
  | { t: 'approved'; resume: string; resumed: boolean }
  | { t: 'rejected' }
  | { t: 'busy' }
  | { t: 'ping'; n: number }
  | { t: 'state'; selectedId: string | null; focus: boolean; level: FocusLevelWire; primaryOnly: boolean; toolbar: boolean; source: 'local' | 'phone' }
  /** Paged list of titles the TV displays (for the phone's idea picker): page i of n of transfer `gid`. */
  | { t: 'index'; gid: string; i: number; n: number; nodes: Array<{ id: string; title: string; parentId: string | null }> }
  | { t: 'graph-ack'; gid: string; i: number }
  | { t: 'graph-done'; gid: string; nodes: number; edges: number }
  | { t: 'graph-error'; gid: string; reason: GraphErrorReason }
  | { t: 'ended'; reason: 'exit' | 'disconnect' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const isToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
const isGid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8,32}$/.test(v);
const DEVICES = ['iphone', 'ipad', 'android', 'mac', 'windows', 'other'];
const GRAPH_ERRORS = ['invalid', 'too-large', 'unexpected', 'mismatch'];
/** Per-part item cap (a part is ≤ 6 KiB, so this is far above what a valid part can hold). */
const MAX_PART_ITEMS = 500;

export function parsePreAuthMessage(raw: unknown): HelloMessage | AuthMessage | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'hello' && isInt(raw.v, 0, 1000) && isStr(raw.device, 16) && DEVICES.includes(raw.device)) {
    if (raw.resume !== undefined && !isToken(raw.resume)) return null;
    return { t: 'hello', v: raw.v, device: raw.device as DeviceKind, ...(raw.resume ? { resume: raw.resume as string } : {}) };
  }
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
    case 'pong':
      return isInt(raw.n, 0, Number.MAX_SAFE_INTEGER) ? { t: 'pong', n: raw.n, seq } : null;
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
    case 'graph-begin':
      return isGid(raw.gid) && isInt(raw.parts, 1, 100_000) && isInt(raw.nodes, 0, 1_000_000) && isInt(raw.edges, 0, 1_000_000)
        ? { t: 'graph-begin', gid: raw.gid, parts: raw.parts, nodes: raw.nodes, edges: raw.edges, seq }
        : null;
    case 'graph-part':
      // Item contents are validated after reassembly (fromSharedGraph); here only the envelope and bounds.
      if (!isGid(raw.gid) || !isInt(raw.i, 0, 100_000) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
      if (raw.nodes.length + raw.edges.length > MAX_PART_ITEMS || !raw.nodes.every(isObj) || !raw.edges.every(isObj)) return null;
      return { t: 'graph-part', gid: raw.gid, i: raw.i, nodes: raw.nodes as unknown as GraphPart['nodes'], edges: raw.edges as unknown as GraphPart['edges'], seq };
    case 'graph-abort':
      return isGid(raw.gid) ? { t: 'graph-abort', gid: raw.gid, seq } : null;
    default:
      return null;
  }
}

export function parseTvMessage(raw: unknown): TvMessage | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'challenge':
      return isInt(raw.v, 0, 1000) && isStr(raw.nonce, 64) ? { t: 'challenge', v: raw.v, nonce: raw.nonce } : null;
    case 'auth-fail':
      return ['bad-proof', 'expired', 'timeout', 'version'].includes(raw.reason as string) ? { t: 'auth-fail', reason: raw.reason as 'bad-proof' } : null;
    case 'approved':
      return isToken(raw.resume) && typeof raw.resumed === 'boolean' ? { t: 'approved', resume: raw.resume, resumed: raw.resumed } : null;
    case 'pending':
    case 'rejected':
    case 'busy':
      return { t: raw.t };
    case 'ping':
      return isInt(raw.n, 0, Number.MAX_SAFE_INTEGER) ? { t: 'ping', n: raw.n } : null;
    case 'ended':
      return raw.reason === 'exit' || raw.reason === 'disconnect' ? { t: 'ended', reason: raw.reason } : null;
    case 'graph-ack':
      return isGid(raw.gid) && isInt(raw.i, 0, 100_000) ? { t: 'graph-ack', gid: raw.gid, i: raw.i } : null;
    case 'graph-done':
      return isGid(raw.gid) && isInt(raw.nodes, 0, 1_000_000) && isInt(raw.edges, 0, 1_000_000) ? { t: 'graph-done', gid: raw.gid, nodes: raw.nodes, edges: raw.edges } : null;
    case 'graph-error':
      return isGid(raw.gid) && GRAPH_ERRORS.includes(raw.reason as string) ? { t: 'graph-error', gid: raw.gid, reason: raw.reason as GraphErrorReason } : null;
    case 'state':
      if ((raw.selectedId !== null && !isStr(raw.selectedId, 128)) || typeof raw.focus !== 'boolean' || (raw.level !== 1 && raw.level !== 2) || typeof raw.primaryOnly !== 'boolean' || typeof raw.toolbar !== 'boolean' || (raw.source !== 'local' && raw.source !== 'phone')) return null;
      return { t: 'state', selectedId: raw.selectedId as string | null, focus: raw.focus, level: raw.level, primaryOnly: raw.primaryOnly, toolbar: raw.toolbar, source: raw.source };
    case 'index': {
      if (!isGid(raw.gid) || !isInt(raw.n, 1, 1000) || !isInt(raw.i, 0, 999) || raw.i >= raw.n || !Array.isArray(raw.nodes) || raw.nodes.length > 500) return null;
      const nodes: Array<{ id: string; title: string; parentId: string | null }> = [];
      for (const n of raw.nodes) {
        if (!isObj(n) || !isStr(n.id, 128) || !isStr(n.title, 120) || (n.parentId !== null && !isStr(n.parentId, 128))) return null;
        nodes.push({ id: n.id, title: n.title, parentId: n.parentId as string | null });
      }
      return { t: 'index', gid: raw.gid, i: raw.i, n: raw.n, nodes };
    }
    default:
      return null;
  }
}
