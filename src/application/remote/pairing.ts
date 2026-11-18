/**
 * Pairing primitives for the TV ⇄ phone companion link. Pure, framework-free, WebCrypto only.
 *
 * Security model (see docs/TV_MODE.md):
 *  - The TV shows a short-lived pairing code (10 chars, ~49.5 bits) as a QR link and as text.
 *  - The signaling server only ever sees a *hash* of the code (the TV's peer id), never the code.
 *  - On connect the TV sends a fresh random nonce; the phone proves knowledge of the code with
 *    HMAC-SHA256(code, nonce | phonePeerId). Proofs are bound to one nonce and one peer, so a
 *    captured proof cannot be replayed on another connection.
 *  - Even a valid proof only creates a *pending* request: the TV owner must explicitly approve it.
 *  - Codes expire after PAIRING_TTL_MS if unused, and rotate after MAX_AUTH_FAILURES bad proofs.
 *  - After authentication every command carries a strictly increasing sequence number.
 *  - Transport is a WebRTC DataChannel (DTLS-encrypted, peer-to-peer).
 */

/** Unambiguous alphabet: no 0/O, 1/I/L. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 10;
export const PAIRING_TTL_MS = 5 * 60_000;
export const MAX_AUTH_FAILURES = 5;
export const AUTH_TIMEOUT_MS = 15_000;
export const PROTOCOL_VERSION = 1;
const PEER_PREFIX = 'omtv-';

function cryptoApi(): Crypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto unavailable (requires a secure context: HTTPS or localhost)');
  return c;
}

const toHex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Uniformly random code (rejection sampling avoids modulo bias). */
export function generatePairingCode(): string {
  const c = cryptoApi();
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < CODE_LENGTH) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    for (const b of bytes) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}

/** "ABCDE-FGHJK" for display. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Accepts user input with spaces/dashes/lowercase; returns null if it cannot be a valid code. */
export function normalizePairingCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0'); // a typed O can never be valid — makes the error explicit below
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** The TV's public signaling id: a hash of the code, so the signaling server never learns the code. */
export async function peerIdForCode(code: string): Promise<string> {
  const digest = await cryptoApi().subtle.digest('SHA-256', new TextEncoder().encode(`orbital-mind/pair/v${PROTOCOL_VERSION}/${code}`));
  return PEER_PREFIX + toHex(digest).slice(0, 40);
}

export function randomNonce(bytes = 16): string {
  return toHex(cryptoApi().getRandomValues(new Uint8Array(bytes)));
}

async function hmacKey(code: string): Promise<CryptoKey> {
  return cryptoApi().subtle.importKey('raw', new TextEncoder().encode(`orbital-mind/auth/${code}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Phone side: prove knowledge of the code for this nonce and this connection. */
export async function computeProof(code: string, nonce: string, controllerId: string): Promise<string> {
  const sig = await cryptoApi().subtle.sign('HMAC', await hmacKey(code), new TextEncoder().encode(`${nonce}|${controllerId}`));
  return toHex(sig);
}

/** TV side: constant-time comparison of the expected and received proof. */
export async function verifyProof(code: string, nonce: string, controllerId: string, proof: unknown): Promise<boolean> {
  if (typeof proof !== 'string' || proof.length !== 64) return false;
  const expected = await computeProof(code, nonce, controllerId);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return diff === 0;
}

/** Tracks strictly increasing sequence numbers (replay / reorder protection for commands). */
export class SequenceGuard {
  private last = 0;
  accept(seq: unknown): boolean {
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= this.last) return false;
    this.last = seq;
    return true;
  }
}

/** A short, friendly description of the connecting device (shown on the TV approval prompt). */
export function describeDevice(userAgent: string): 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'other' {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone')) return 'iphone';
  if (ua.includes('ipad')) return 'ipad';
  if (ua.includes('android')) return 'android';
  if (ua.includes('mac os')) return 'mac';
  if (ua.includes('windows')) return 'windows';
  return 'other';
}
