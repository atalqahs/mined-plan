import type { GraphSnapshot } from '@/domain/entities/types';
import { remoteDiagnostics as diag } from './diagnostics';
import { fromSharedGraph, GraphReceiver } from './graphShare';
import {
  AUTH_TIMEOUT_MS,
  generatePairingCode,
  MAX_AUTH_FAILURES,
  PAIRING_TTL_MS,
  peerIdForCode,
  PROTOCOL_VERSION,
  randomNonce,
  SequenceGuard,
  verifyProof,
} from './pairing';
import { parseCommand, parsePreAuthMessage, type FocusLevelWire, type SequencedCommand, type TvMessage } from './protocol';
import { MAX_FRAME_BYTES, realTimers, type ChannelCloseReason, type DeviceKind, type RemoteChannel, type RemoteListener, type RemoteTransport, type TimerApi } from './types';

/** Close after a short delay so a final message (auth-fail, busy, ended…) is flushed first. */
function closeSoon(ch: RemoteChannel) {
  setTimeout(() => ch.close(), 60);
}

export type TvSessionState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'waiting'; code: string; expiresAt: number }
  | { kind: 'pending'; code: string; device: DeviceKind }
  | { kind: 'connected'; device: DeviceKind }
  /** The approved phone's channel dropped unexpectedly; it may resume (same code + resume token) until `until`. */
  | { kind: 'reconnecting'; device: DeviceKind; until: number }
  | { kind: 'error'; reason: 'signaling' | 'unsupported' };

export type TvSessionEvent =
  | { type: 'phone-left' } // explicit disconnect / bye / TV disconnect
  | { type: 'phone-lost'; reason: ChannelCloseReason | 'silent' } // channel dropped; grace period started
  | { type: 'resumed' }
  | { type: 'grace-expired' }
  | { type: 'graph-shown'; nodes: number; edges: number }
  | { type: 'graph-failed'; reason: string };

/** What the TV does with authenticated commands. Implemented by the presentation layer. */
export interface TvCommandSink {
  orbit(azimuth: number, polar: number): void;
  zoom(factor: number): void;
  reset(): void;
  select(id: string | null): void;
  focus(on: boolean, level?: FocusLevelWire): void;
  primaryOnly(on: boolean): void;
  toolbar(visible: boolean): void;
  exitTv(): void;
  /** A validated graph shared by the phone, or null when sharing stops / the phone is gone. */
  graph(snapshot: GraphSnapshot | null): void;
}

export interface TvSessionOptions {
  ttlMs?: number;
  /** How long an unexpectedly dropped phone may resume before temporary data is cleared. */
  graceMs?: number;
  pingMs?: number;
  /** Silence after which the link is considered dead. */
  silenceMs?: number;
}

const enc = new TextEncoder();

/**
 * TV side of the companion link. Owns the pairing code lifecycle and is the only
 * place that decides whether a remote device may control this screen.
 */
export class TvSession {
  private state: TvSessionState = { kind: 'idle' };
  private listeners = new Set<(s: TvSessionState) => void>();
  private eventListeners = new Set<(e: TvSessionEvent) => void>();
  private listener: RemoteListener | null = null;
  private code = '';
  private expiryTimer: unknown = null;
  private graceTimer: unknown = null;
  private pingTimer: unknown = null;
  private failures = 0;
  private channel: RemoteChannel | null = null; // authenticated (pending or connected)
  private device: DeviceKind = 'other';
  private resumeToken: string | null = null;
  private seq = new SequenceGuard();
  private receiver = new GraphReceiver();
  private sharing = false;
  private stopped = false;
  private lastSeen = 0;
  private pingN = 0;
  private readonly ttlMs: number;
  private readonly graceMs: number;
  private readonly pingMs: number;
  private readonly silenceMs: number;

  constructor(
    private readonly transport: RemoteTransport,
    private readonly sink: TvCommandSink,
    private readonly timers: TimerApi = realTimers,
    options: TvSessionOptions | number = {},
  ) {
    const o = typeof options === 'number' ? { ttlMs: options } : options;
    this.ttlMs = o.ttlMs ?? PAIRING_TTL_MS;
    this.graceMs = o.graceMs ?? 90_000;
    this.pingMs = o.pingMs ?? 4_000;
    this.silenceMs = o.silenceMs ?? 25_000;
  }

  getState(): TvSessionState {
    return this.state;
  }

  onState(listener: (s: TvSessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (e: TvSessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.rotateCode();
  }

  /** Owner approves the pending device. */
  approve(): void {
    if (this.state.kind !== 'pending' || !this.channel) return;
    this.clearExpiry();
    this.resumeToken = randomNonce(16);
    this.send({ t: 'approved', resume: this.resumeToken, resumed: false });
    this.setState({ kind: 'connected', device: this.device });
    diag.log('tv.approved', { device: this.device });
    this.startHeartbeat();
  }

  /** Owner rejects the pending device; the code is rotated so it cannot simply retry. */
  reject(): void {
    if (this.state.kind !== 'pending' || !this.channel) return;
    this.send({ t: 'rejected' });
    diag.log('tv.rejected');
    this.dropChannel();
    void this.rotateCode();
  }

  /** End the current phone session (TV side). Temporary data is cleared immediately. */
  disconnect(): void {
    if (!this.channel && this.state.kind !== 'reconnecting') return;
    this.send({ t: 'ended', reason: 'disconnect' });
    diag.log('tv.disconnect', { by: 'tv' });
    this.endSession('phone-left');
  }

  /** Tear everything down (leaving TV mode). Clears any shared graph from memory. */
  stop(): void {
    this.stopped = true;
    if (this.channel) this.send({ t: 'ended', reason: 'exit' });
    this.dropChannel();
    this.clearShared();
    this.clearExpiry();
    this.clearGrace();
    this.listener?.close();
    this.listener = null;
    this.setState({ kind: 'idle' });
  }

  sendState(state: Omit<Extract<TvMessage, { t: 'state' }>, 't' | 'source'>): void {
    if (this.state.kind === 'connected') this.send({ t: 'state', ...state, source: this.sharing ? 'phone' : 'local' });
  }

  /** Paged so no frame exceeds the byte budget, however many titles the TV displays. */
  sendIndex(nodes: Array<{ id: string; title: string; parentId: string | null }>): void {
    if (this.state.kind !== 'connected') return;
    const pages: Array<typeof nodes> = [];
    let page: typeof nodes = [];
    let used = 0;
    const budget = Math.floor(MAX_FRAME_BYTES * 0.6);
    for (const n of nodes.slice(0, 5000)) {
      const size = enc.encode(JSON.stringify(n)).byteLength + 1;
      if ((used + size > budget || page.length >= 400) && page.length) {
        pages.push(page);
        page = [];
        used = 0;
      }
      page.push(n);
      used += size;
    }
    pages.push(page);
    const gid = randomNonce(8);
    pages.forEach((p, i) => this.send({ t: 'index', gid, i, n: pages.length, nodes: p }));
  }

  // ---------------------------------------------------------------------------

  private async rotateCode(): Promise<void> {
    if (this.stopped) return;
    this.clearExpiry();
    this.listener?.close();
    this.listener = null;
    this.failures = 0;
    this.resumeToken = null;
    this.setState({ kind: 'starting' });
    this.code = generatePairingCode();
    let peerId: string;
    try {
      peerId = await peerIdForCode(this.code);
    } catch {
      this.setState({ kind: 'error', reason: 'unsupported' });
      return;
    }
    try {
      this.listener = await this.transport.listen(peerId, (ch) => this.accept(ch));
    } catch {
      if (!this.stopped) this.setState({ kind: 'error', reason: 'signaling' });
      return;
    }
    if (this.stopped) {
      this.listener.close();
      return;
    }
    const expiresAt = this.timers.now() + this.ttlMs;
    this.setState({ kind: 'waiting', code: this.code, expiresAt });
    this.expiryTimer = this.timers.setTimeout(() => {
      if (this.state.kind === 'waiting') void this.rotateCode();
    }, this.ttlMs);
  }

  private accept(ch: RemoteChannel): void {
    const resuming = this.state.kind === 'reconnecting';
    if (this.channel || (this.state.kind !== 'waiting' && !resuming)) {
      ch.send({ t: 'busy' } satisfies TvMessage);
      closeSoon(ch);
      return;
    }
    const code = this.code;
    const nonce = randomNonce();
    let device: DeviceKind = 'other';
    let resume: string | undefined;
    let authed = false;
    const authTimer = this.timers.setTimeout(() => {
      if (!authed) {
        ch.send({ t: 'auth-fail', reason: 'timeout' } satisfies TvMessage);
        closeSoon(ch);
      }
    }, AUTH_TIMEOUT_MS);

    // The phone speaks first (hello); the challenge is the reply — no message can arrive before a handler exists.
    ch.onMessage(async (raw) => {
      if (!authed) {
        const msg = parsePreAuthMessage(raw);
        if (!msg) return;
        if (msg.t === 'hello') {
          if (msg.v !== PROTOCOL_VERSION) {
            ch.send({ t: 'auth-fail', reason: 'version' } satisfies TvMessage);
            closeSoon(ch);
            return;
          }
          device = msg.device;
          resume = msg.resume;
          ch.send({ t: 'challenge', v: PROTOCOL_VERSION, nonce } satisfies TvMessage);
          return;
        }
        // auth
        const stillOpen = this.code === code && !this.channel && (this.state.kind === 'waiting' || this.state.kind === 'reconnecting');
        if (!stillOpen) {
          ch.send({ t: 'auth-fail', reason: 'expired' } satisfies TvMessage);
          closeSoon(ch);
          return;
        }
        const ok = await verifyProof(code, nonce, ch.remoteId, msg.proof);
        // While a phone may resume, only that phone (valid resume token) is let in.
        const isResume = ok && this.state.kind === 'reconnecting' && !!resume && resume === this.resumeToken;
        if (!ok || this.channel || this.code !== code || (this.state.kind === 'reconnecting' && !isResume)) {
          ch.send(ok ? ({ t: 'busy' } satisfies TvMessage) : ({ t: 'auth-fail', reason: 'bad-proof' } satisfies TvMessage));
          closeSoon(ch);
          diag.log('tv.auth-refused', { proof: ok, resuming: this.state.kind === 'reconnecting' });
          if (!ok && ++this.failures >= MAX_AUTH_FAILURES) void this.rotateCode();
          return;
        }
        authed = true;
        this.timers.clearTimeout(authTimer);
        this.channel = ch;
        this.seq = new SequenceGuard();
        this.lastSeen = this.timers.now();
        if (isResume) {
          // Same approved phone coming back after a drop: no new prompt, fresh one-time token.
          this.clearGrace();
          this.resumeToken = randomNonce(16);
          this.send({ t: 'approved', resume: this.resumeToken, resumed: true });
          this.setState({ kind: 'connected', device: this.device });
          diag.log('tv.resumed');
          this.emit({ type: 'resumed' });
          this.startHeartbeat();
          return;
        }
        this.device = device;
        ch.send({ t: 'pending' } satisfies TvMessage);
        this.setState({ kind: 'pending', code, device });
        diag.log('tv.pending', { device });
        return;
      }
      if (this.channel !== ch) return;
      this.lastSeen = this.timers.now();
      // Commands are honoured only once the owner approved this channel.
      if (this.state.kind !== 'connected') return;
      const cmd = parseCommand(raw);
      if (!cmd || !this.seq.accept(cmd.seq)) return;
      this.dispatch(cmd);
    });
    ch.onClose((reason) => {
      this.timers.clearTimeout(authTimer);
      if (this.channel !== ch) return;
      this.onChannelLost(reason);
    });
  }

  private dispatch(cmd: SequencedCommand): void {
    const s = this.sink;
    switch (cmd.t) {
      case 'orbit':
        return s.orbit(cmd.az, cmd.pol);
      case 'zoom':
        return s.zoom(cmd.factor);
      case 'reset':
        return s.reset();
      case 'select':
        return s.select(cmd.id);
      case 'focus':
        return s.focus(cmd.on, cmd.level);
      case 'primaryOnly':
        return s.primaryOnly(cmd.on);
      case 'toolbar':
        return s.toolbar(cmd.visible);
      case 'exitTv':
        return s.exitTv();
      case 'pong':
        return;
      case 'graph-begin': {
        const r = this.receiver.begin(cmd.gid, cmd.parts, cmd.nodes, cmd.edges);
        diag.log('tv.graph-begin', { parts: cmd.parts, nodes: cmd.nodes, edges: cmd.edges });
        if (r.status === 'error') this.graphFailed(cmd.gid, r.reason);
        return;
      }
      case 'graph-part': {
        const r = this.receiver.add(cmd.gid, cmd.i, { nodes: cmd.nodes, edges: cmd.edges });
        if (r.status === 'error') {
          // A stray part from a superseded transfer is ignored; anything else fails the transfer.
          if (r.reason !== 'unexpected' || this.receiver.activeId === cmd.gid) this.graphFailed(cmd.gid, r.reason);
          return;
        }
        this.send({ t: 'graph-ack', gid: cmd.gid, i: cmd.i });
        if (r.status !== 'complete') return;
        const snapshot = fromSharedGraph(r.graph);
        if (!snapshot) return this.graphFailed(cmd.gid, 'invalid');
        this.sharing = true;
        s.graph(snapshot);
        this.send({ t: 'graph-done', gid: cmd.gid, nodes: snapshot.nodes.size, edges: snapshot.edges.size });
        diag.log('tv.graph-shown', { nodes: snapshot.nodes.size, edges: snapshot.edges.size });
        this.emit({ type: 'graph-shown', nodes: snapshot.nodes.size, edges: snapshot.edges.size });
        return;
      }
      case 'graph-abort':
        if (this.receiver.activeId === cmd.gid) this.receiver.reset();
        diag.log('tv.graph-abort');
        return;
      case 'graph-stop':
        this.receiver.reset();
        this.clearShared();
        diag.log('tv.graph-stop');
        return;
      case 'bye':
        diag.log('tv.disconnect', { by: 'phone' });
        return this.endSession('phone-left');
    }
  }

  private graphFailed(gid: string, reason: string): void {
    this.receiver.reset();
    this.send({ t: 'graph-error', gid, reason: reason as 'invalid' });
    diag.log('tv.graph-failed', { reason });
    this.emit({ type: 'graph-failed', reason });
  }

  /** Unexpected loss of the approved phone: keep the session (and its temporary graph) for a grace period. */
  private onChannelLost(reason: ChannelCloseReason | 'silent'): void {
    const wasConnected = this.state.kind === 'connected';
    this.channel = null;
    this.stopHeartbeat();
    this.receiver.reset();
    diag.log('tv.phone-lost', { reason, wasConnected });
    if (!wasConnected || this.stopped) {
      // Lost while pending approval (or after stop): nothing to resume.
      this.endSession('phone-left');
      return;
    }
    const until = this.timers.now() + this.graceMs;
    this.setState({ kind: 'reconnecting', device: this.device, until });
    this.emit({ type: 'phone-lost', reason });
    this.clearGrace();
    this.graceTimer = this.timers.setTimeout(() => {
      if (this.state.kind !== 'reconnecting') return;
      diag.log('tv.grace-expired');
      this.emit({ type: 'grace-expired' });
      this.endSession(null);
    }, this.graceMs);
  }

  /** Final cleanup of a phone session: drop the channel and all temporary data, issue a fresh code. */
  private endSession(event: 'phone-left' | null): void {
    this.dropChannel();
    this.stopHeartbeat();
    this.clearGrace();
    this.clearShared();
    this.resumeToken = null;
    if (event) this.emit({ type: event });
    if (!this.stopped) void this.rotateCode();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const tick = () => {
      if (this.state.kind !== 'connected' || !this.channel) return;
      const silent = this.timers.now() - this.lastSeen;
      if (silent > this.silenceMs) {
        diag.log('tv.silence', { ms: silent });
        const ch = this.channel;
        this.onChannelLost('silent');
        ch.close();
        return;
      }
      this.send({ t: 'ping', n: ++this.pingN });
      this.pingTimer = this.timers.setTimeout(tick, this.pingMs);
    };
    this.pingTimer = this.timers.setTimeout(tick, this.pingMs);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) this.timers.clearTimeout(this.pingTimer);
    this.pingTimer = null;
  }

  private clearShared(): void {
    if (this.sharing) this.sink.graph(null); // temporary phone data is discarded immediately
    this.sharing = false;
  }

  private dropChannel(): void {
    const ch = this.channel;
    this.channel = null;
    this.receiver.reset();
    if (ch) closeSoon(ch);
  }

  private send(msg: TvMessage): void {
    if (this.channel && !this.channel.send(msg)) diag.log('tv.send-refused', { type: msg.t });
  }

  private clearExpiry(): void {
    if (this.expiryTimer !== null) this.timers.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private clearGrace(): void {
    if (this.graceTimer !== null) this.timers.clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  private emit(e: TvSessionEvent): void {
    for (const l of this.eventListeners) l(e);
  }

  private setState(s: TvSessionState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }
}
