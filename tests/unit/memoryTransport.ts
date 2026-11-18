import { TransportError, type RemoteChannel, type RemoteListener, type RemoteTransport } from '@/application/remote/types';

/** In-memory transport: async, JSON-cloned delivery, like a real data channel. */
export class MemoryHub {
  private peers = new Map<string, (ch: RemoteChannel) => void>();
  private seq = 0;

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
        const clientId = `client-${++this.seq}`;
        const [a, b] = pair(clientId, id);
        target(b);
        return a;
      },
    };
  }
}

function pair(aId: string, bId: string): [RemoteChannel & { raw(msg: unknown): void }, RemoteChannel] {
  const make = (local: string, remote: string) => {
    const msgL = new Set<(m: unknown) => void>();
    const closeL = new Set<() => void>();
    let closed = false;
    const backlog: unknown[] = [];
    return { local, remote, msgL, closeL, backlog, get closed() { return closed; }, setClosed() { closed = true; } };
  };
  const A = make(aId, bId);
  const B = make(bId, aId);
  const channel = (me: typeof A, other: typeof B): RemoteChannel & { raw(msg: unknown): void } => ({
    localId: me.local,
    remoteId: me.remote,
    send(msg) {
      if (me.closed) return;
      const copy = JSON.parse(JSON.stringify(msg));
      queueMicrotask(() => {
        if (other.closed) return;
        if (!other.msgL.size) other.backlog.push(copy); // buffered until a handler attaches (like the PeerJS adapter)
        else for (const l of other.msgL) l(copy);
      });
    },
    raw(msg) { this.send(msg); },
    onMessage(l) {
      me.msgL.add(l);
      const pending = me.backlog.splice(0);
      if (pending.length) queueMicrotask(() => pending.forEach((x) => l(x)));
      return () => me.msgL.delete(l);
    },
    onClose(l) { me.closeL.add(l); return () => me.closeL.delete(l); },
    close() {
      if (me.closed) return;
      me.setClosed(); other.setClosed();
      queueMicrotask(() => { for (const l of me.closeL) l(); for (const l of other.closeL) l(); });
    },
  });
  return [channel(A, B), channel(B, A)];
}

export const settle = async (ms = 0) => { for (let i = 0; i < 20; i++) await Promise.resolve(); if (ms) await new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 20; i++) await Promise.resolve(); };
