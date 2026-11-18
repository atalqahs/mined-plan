import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { remoteDiagnostics as diag } from '@/application/remote/diagnostics';
import { MAX_FRAME_BYTES, TransportError, type ChannelCloseReason, type RemoteChannel, type RemoteListener, type RemoteTransport } from '@/application/remote/types';

/**
 * WebRTC transport (PeerJS). Data flows peer-to-peer over a DTLS-encrypted
 * DataChannel; the signaling server only brokers the connection (it sees the
 * hashed peer ids and network candidates, never the graph or the pairing code).
 *
 * Lessons from production (see docs/TV_MODE.md → "Incident: disconnects"):
 *  - PeerJS's `json` serializer refuses messages ≥ 16,300 UTF-8 bytes by emitting an
 *    error. We use `raw` serialization with our own JSON framing and byte-size checks.
 *  - A DataConnection `error` is NOT a closed channel. Only `close` ends a channel.
 *  - Losing the signaling WebSocket must never tear down an open peer-to-peer channel;
 *    signaling is only needed to establish (or re-establish) connections.
 *
 * Signaling server resolution:
 *   1. Build-time env (self-hosted PeerServer): VITE_SIGNALING_HOST / _PORT / _PATH / _SECURE / _KEY
 *   2. Otherwise the free public PeerJS cloud server (0.peerjs.com).
 *   3. `?signal=host:port` — honoured ONLY when the app itself runs on localhost (tests).
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
const MAX_INBOUND_CHARS = 64_000;
const encoder = new TextEncoder();

/** Open connections, so tests can simulate a network drop (localhost builds only, see below). */
const live = new Set<DataConnection>();
if (typeof window !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  // Simulates the WebRTC path dying (e.g. Wi-Fi roam / iOS suspending the page): closes the
  // underlying RTCPeerConnection without any protocol goodbye.
  (window as unknown as { __orbitalDropLinks?: () => number }).__orbitalDropLinks = () => {
    const n = live.size;
    for (const c of [...live]) {
      c.peerConnection?.close();
      c.close();
    }
    return n;
  };
}

function supported() {
  return typeof RTCPeerConnection !== 'undefined';
}

/** Keep the signaling registration alive (needed only to accept new / resumed connections). */
function keepSignaling(peer: Peer, role: string) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  peer.on('open', () => {
    if (attempt) diag.log('signal.reopen', { role, attempt });
    attempt = 0;
  });
  peer.on('disconnected', () => {
    diag.log('signal.lost', { role });
    if (peer.destroyed || timer) return;
    const retry = () => {
      timer = null;
      if (peer.destroyed || !peer.disconnected) return;
      attempt++;
      try {
        peer.reconnect();
      } catch {
        /* ignored — next attempt */
      }
      timer = setTimeout(retry, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    };
    timer = setTimeout(retry, 1000);
  });
  // Peer-level errors after setup are logged only; they never destroy open data channels.
  peer.on('error', (err: { type?: string }) => diag.log('signal.error', { role, type: err.type ?? 'unknown' }));
}

/** Wrap a DataConnection; inbound frames are buffered until the first handler attaches. */
function wrap(conn: DataConnection, localId: string, role: string): RemoteChannel {
  const handlers = new Set<(m: unknown) => void>();
  const closeHandlers = new Set<(r: ChannelCloseReason) => void>();
  const backlog: unknown[] = [];
  let closed = false;
  let closingLocally = false;
  let lastIce = 'new';

  conn.on('data', (data) => {
    if (typeof data !== 'string' || data.length > MAX_INBOUND_CHARS) {
      diag.log('dc.drop', { role, reason: 'bad-frame' });
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      diag.log('dc.drop', { role, reason: 'bad-json' });
      return;
    }
    if (handlers.size) for (const h of handlers) h(msg);
    else backlog.push(msg);
  });
  conn.on('open', () => {
    live.add(conn);
    const pc = conn.peerConnection;
    const sctp = (pc as RTCPeerConnection & { sctp?: { maxMessageSize?: number } } | undefined)?.sctp;
    diag.log('dc.open', { role, maxMessageSize: sctp?.maxMessageSize ?? -1 });
    pc?.addEventListener('connectionstatechange', () => diag.log('pc.state', { role, state: pc.connectionState }));
  });
  conn.on('iceStateChanged', (state) => {
    lastIce = state;
    diag.log('ice', { role, state });
  });
  // Non-fatal by design: e.g. a send that was refused. PeerJS closes the connection itself
  // (and emits `close`) for genuinely fatal conditions (negotiation failed / ICE closed).
  conn.on('error', (err: { type?: string }) => diag.log('dc.error', { role, type: err.type ?? 'unknown' }));
  conn.on('close', () => {
    live.delete(conn);
    if (closed) return;
    closed = true;
    const reason: ChannelCloseReason = closingLocally ? 'local' : lastIce === 'failed' ? 'ice-failed' : lastIce === 'closed' ? 'ice-closed' : 'remote';
    diag.log('dc.close', { role, reason, ice: lastIce });
    for (const h of closeHandlers) h(reason);
  });

  return {
    localId,
    remoteId: conn.peer,
    send(message) {
      if (closed || !conn.open) return false;
      const frame = JSON.stringify(message);
      const bytes = encoder.encode(frame).byteLength;
      if (bytes > MAX_FRAME_BYTES) {
        diag.log('dc.refuse', { role, bytes });
        return false;
      }
      try {
        void conn.send(frame);
        return true;
      } catch {
        diag.log('dc.send-fail', { role, bytes });
        return false;
      }
    },
    bufferedAmount() {
      // Bytes in the SCTP send buffer + messages PeerJS is holding back (rough byte estimate).
      return (conn.dataChannel?.bufferedAmount ?? 0) + ((conn as unknown as { bufferSize?: number }).bufferSize ?? 0) * 8_000;
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
      closingLocally = true;
      conn.close();
      // PeerJS emits `close` asynchronously; make sure listeners run even if it doesn't.
      setTimeout(() => {
        if (!closed) {
          closed = true;
          diag.log('dc.close', { role, reason: 'local', ice: lastIce });
          for (const h of closeHandlers) h('local');
        }
      }, 500);
    },
  };
}

function waitOpen(peer: Peer): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new TransportError('timeout', 'signaling'));
    }, OPEN_TIMEOUT_MS);
    peer.once('open', (id) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(id);
    });
    peer.once('error', (err: { type?: string }) => {
      if (settled) return;
      settled = true;
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
    diag.log('signal.open', { role: 'tv' });
    keepSignaling(peer, 'tv');
    peer.on('connection', (conn) => {
      diag.log('dc.incoming', { role: 'tv' });
      // Attach the buffering wrapper immediately, then hand it over once the channel is open.
      const ch = wrap(conn, id, 'tv');
      conn.on('open', () => onChannel(ch));
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
    diag.log('signal.open', { role: 'phone' });
    return new Promise<RemoteChannel>((resolve, reject) => {
      let settled = false;
      const conn = peer.connect(id, { reliable: true, serialization: 'raw' });
      const ch = wrap(conn, localId, 'phone');
      const fail = (err: TransportError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new TransportError('timeout', 'datachannel')), OPEN_TIMEOUT_MS);
      // Errors matter only while connecting; afterwards they are logged and ignored (see keepSignaling).
      const onSetupError = (err: { type?: string }) => fail(new TransportError(err.type === 'peer-unavailable' ? 'peer-not-found' : 'network', err.type));
      peer.on('error', onSetupError);
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off('error', onSetupError);
        keepSignaling(peer, 'phone');
        resolve(ch);
      });
      // Closing the channel also releases this phone's signaling registration.
      ch.onClose(() => setTimeout(() => peer.destroy(), 0));
    });
  }
}
