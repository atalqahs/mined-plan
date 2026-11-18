/** Transport port for the companion link. Implemented in infrastructure (WebRTC via PeerJS) and in tests (in-memory). */

export type DeviceKind = 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'other';

/** A bidirectional, ordered, reliable message channel between two peers. */
export interface RemoteChannel {
  /** This side's signaling id (bound into the auth proof). */
  readonly localId: string;
  /** The other side's signaling id. */
  readonly remoteId: string;
  /** Returns false if the message could not be queued (channel closed, frame too large…). Never throws. */
  send(message: unknown): boolean;
  /** Bytes queued in the underlying channel but not yet sent (for backpressure). */
  bufferedAmount(): number;
  onMessage(listener: (message: unknown) => void): () => void;
  /** Fires once when the channel is gone; `reason` is a short machine code for diagnostics/UI. */
  onClose(listener: (reason: ChannelCloseReason) => void): () => void;
  close(): void;
}

export type ChannelCloseReason = 'local' | 'remote' | 'ice-failed' | 'ice-closed' | 'error';

/** Largest serialized frame (UTF-8 bytes) the app will ever send — well below every browser's DataChannel limit. */
export const MAX_FRAME_BYTES = 16_000;

export interface RemoteListener {
  readonly id: string;
  close(): void;
}

export type TransportErrorCode = 'unavailable-id' | 'peer-not-found' | 'network' | 'timeout' | 'unsupported';

export class TransportError extends Error {
  constructor(public readonly code: TransportErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TransportError';
  }
}

export interface RemoteTransport {
  /** Register `id` with the signaling service and accept incoming channels. */
  listen(id: string, onChannel: (channel: RemoteChannel) => void): Promise<RemoteListener>;
  /** Open a channel to the peer registered as `id`. */
  connect(id: string): Promise<RemoteChannel>;
}

export interface TimerApi {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: TimerApi = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as number),
};
