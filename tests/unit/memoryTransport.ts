import { TransportError, type ChannelCloseReason, type RemoteChannel, type RemoteListener, type RemoteTransport } from '@/application/remote/types';

export interface HubOptions {
  /** Refuse frames larger than this many UTF-8 bytes (PeerJS `json` refused ≥ 16,300). */
  maxFrameBytes?: number;
}

type Side = {
  local: string;
  remote: string;
  msgL: Set<(m: unknown) => void>;
  closeL: Set<(r: ChannelCloseReason) => void>;
  backlog: unknown[];
  closed: boolean;
  /** When true, messages from this side are silently dropped (a link that went dead without closing). */
  mute: boolean;
};

const enc = new TextEncoder();

/** In-memory transport: async, JSON-cloned delivery, like a real data channel. */
export class MemoryHub {
  private peers = new Map<string, (ch: RemoteChannel) => void>();
  private seq = 0;
  readonly channels: Array<{ a: ControlledChannel; b: ControlledChannel }> = [];
  refused = 0;

  constructor(private readonly opts: HubOptions = {}) {}

  transport(): RemoteTransport {
    return {
      listen: async (id, onChannel) => {
        if (this.peers.has(id)) throw new TransportError('unavailable-id');
        this.peers.set(id, onChannel);
        const listener: RemoteListener = { id, close: () => this.peers.delete(id) };
        return listener;
      },
      connect: async (id) => {
        const target = this.peers.get(id);
        if (!target) throw new TransportError('peer-not-found');
        const [a, b] = this.pair(`client-${++this.seq}`, id);
        this.channels.push({ a, b });
        target(b);
        return a;
      },
    };
  }

  /** The most recent phone-side channel. */
  lastPhone(): ControlledChannel {
    return this.channels.at(-1)!.a;
  }

  private pair(aId: string, bId: string): [ControlledChannel, ControlledChannel] {
    const make = (local: string, remote: string): Side => ({ local, remote, msgL: new Set(), closeL: new Set(), backlog: [], closed: false, mute: false });
    const A = make(aId, bId);
    const B = make(bId, aId);
    const hub = this;
    const closeBoth = (reason: ChannelCloseReason, initiator: Side) => {
      if (A.closed && B.closed) return;
      A.closed = B.closed = true;
      queueMicrotask(() => {
        for (const s of [A, B]) for (const l of s.closeL) l(s === initiator ? (reason === 'remote' ? 'remote' : 'local') : reason === 'local' ? 'remote' : reason);
      });
    };
    const channel = (me: Side, other: Side): ControlledChannel => ({
      localId: me.local,
      remoteId: me.remote,
      send(msg) {
        if (me.closed) return false;
        const frame = JSON.stringify(msg);
        if (hub.opts.maxFrameBytes && enc.encode(frame).byteLength >= hub.opts.maxFrameBytes) {
          hub.refused++;
          return false;
        }
        if (me.mute) return true;
        const copy = JSON.parse(frame);
        queueMicrotask(() => {
          if (other.closed) return;
          if (!other.msgL.size) other.backlog.push(copy);
          else for (const l of other.msgL) l(copy);
        });
        return true;
      },
      bufferedAmount: () => 0,
      onMessage(l) {
        me.msgL.add(l);
        const pending = me.backlog.splice(0);
        if (pending.length) queueMicrotask(() => pending.forEach((x) => l(x)));
        return () => me.msgL.delete(l);
      },
      onClose(l) {
        me.closeL.add(l);
        return () => me.closeL.delete(l);
      },
      close() {
        closeBoth('local', me);
      },
      drop(reason: ChannelCloseReason = 'ice-failed') {
        closeBoth(reason, other); // both sides see an unexpected close
      },
      mute() {
        me.mute = true;
        other.mute = true;
      },
    });
    return [channel(A, B), channel(B, A)];
  }
}

export type ControlledChannel = RemoteChannel & { drop(reason?: ChannelCloseReason): void; mute(): void };

export const settle = async (ms = 0) => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  if (ms) await new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
