import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { TransportError, type RemoteChannel, type RemoteListener, type RemoteTransport } from '@/application/remote/types';

/**
 * WebRTC transport (PeerJS). Data flows peer-to-peer over a DTLS-encrypted
 * DataChannel; the signaling server only brokers the connection (it sees the
 * hashed peer ids and network candidates, never the graph or the pairing code).
 *
 * Signaling server resolution:
 *   1. Build-time env (self-hosted PeerServer): VITE_SIGNALING_HOST / _PORT / _PATH / _SECURE / _KEY
 *   2. Otherwise the free public PeerJS cloud server (0.peerjs.com).
 *   3. `?signal=host:port` — honoured ONLY when the app itself runs on localhost (tests),
 *      so a crafted link can never redirect a real user to a foreign signaling server.
 */
export function signalingOptions(): PeerOptions {
  const env = import.meta.env;
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const isLocal = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  const override = isLocal ? new URLSearchParams(location.search).get('signal') : null;
  if (override) {
    const [host, port] = override.split(':');
    return { host, port: Number(port) || 9000, path: '/', secure: false, key: 'peerjs', config: { iceServers: [] }, debug: 0 };
  }
  if (env.VITE_SIGNALING_HOST) {
    return {
      host: env.VITE_SIGNALING_HOST,
      port: Number(env.VITE_SIGNALING_PORT ?? 443),
      path: env.VITE_SIGNALING_PATH ?? '/',
      secure: (env.VITE_SIGNALING_SECURE ?? 'true') !== 'false',
      key: env.VITE_SIGNALING_KEY ?? 'peerjs',
      config: { iceServers },
      debug: 0,
    };
  }
  return { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs', config: { iceServers }, debug: 0 };
}

const OPEN_TIMEOUT_MS = 15_000;

function supported() {
  return typeof RTCPeerConnection !== 'undefined';
}

/** Wrap a DataConnection; inbound messages are buffered until the first handler attaches. */
function wrap(conn: DataConnection, localId: string): RemoteChannel {
  const handlers = new Set<(m: unknown) => void>();
  const closeHandlers = new Set<() => void>();
  const backlog: unknown[] = [];
  let closed = false;
  conn.on('data', (data) => {
    if (handlers.size) for (const h of handlers) h(data);
    else backlog.push(data);
  });
  const onClosed = () => {
    if (closed) return;
    closed = true;
    for (const h of closeHandlers) h();
  };
  conn.on('close', onClosed);
  conn.on('error', onClosed);
  return {
    localId,
    remoteId: conn.peer,
    send(message) {
      if (!closed && conn.open) void conn.send(message);
    },
    onMessage(h) {
      handlers.add(h);
      const pending = backlog.splice(0);
      for (const m of pending) h(m);
      return () => handlers.delete(h);
    },
    onClose(h) {
      closeHandlers.add(h);
      return () => closeHandlers.delete(h);
    },
    close() {
      if (closed) return;
      try {
        conn.close();
      } finally {
        onClosed();
      }
    },
  };
}

function waitOpen(peer: Peer): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TransportError('timeout', 'signaling')), OPEN_TIMEOUT_MS);
    peer.once('open', (id) => {
      clearTimeout(timer);
      resolve(id);
    });
    peer.once('error', (err: { type?: string }) => {
      clearTimeout(timer);
      reject(new TransportError(err.type === 'unavailable-id' ? 'unavailable-id' : err.type === 'browser-incompatible' ? 'unsupported' : 'network', err.type));
    });
  });
}

export class PeerTransport implements RemoteTransport {
  constructor(private readonly options: PeerOptions = signalingOptions()) {}

  async listen(id: string, onChannel: (channel: RemoteChannel) => void): Promise<RemoteListener> {
    if (!supported()) throw new TransportError('unsupported');
    const peer = new Peer(id, this.options);
    await waitOpen(peer).catch((e) => {
      peer.destroy();
      throw e;
    });
    peer.on('connection', (conn) => {
      // Attach the buffering wrapper immediately, then hand it over once the channel is open.
      const ch = wrap(conn, id);
      conn.on('open', () => onChannel(ch));
    });
    // Keep the signaling registration alive across transient websocket drops.
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    return { id, close: () => peer.destroy() };
  }

  async connect(id: string): Promise<RemoteChannel> {
    if (!supported()) throw new TransportError('unsupported');
    const peer = new Peer(this.options);
    const localId = await waitOpen(peer).catch((e) => {
      peer.destroy();
      throw e;
    });
    return new Promise<RemoteChannel>((resolve, reject) => {
      const conn = peer.connect(id, { reliable: true, serialization: 'json' });
      const ch = wrap(conn, localId);
      const timer = setTimeout(() => {
        peer.destroy();
        reject(new TransportError('timeout', 'datachannel'));
      }, OPEN_TIMEOUT_MS);
      peer.on('error', (err: { type?: string }) => {
        clearTimeout(timer);
        peer.destroy();
        reject(new TransportError(err.type === 'peer-unavailable' ? 'peer-not-found' : 'network', err.type));
      });
      conn.on('open', () => {
        clearTimeout(timer);
        resolve(ch);
      });
      // Closing the channel also releases this phone's signaling registration.
      ch.onClose(() => setTimeout(() => peer.destroy(), 0));
    });
  }
}
