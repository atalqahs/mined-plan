import type { GraphSnapshot } from '@/domain/entities/types';
import { fromSharedGraph, GraphAssembler } from './graphShare';
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
import { parseCommand, parsePreAuthMessage, type FocusLevelWire, type TvMessage } from './protocol';
import { realTimers, type DeviceKind, type RemoteChannel, type RemoteListener, type RemoteTransport, type TimerApi } from './types';

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
  | { kind: 'error'; reason: 'signaling' | 'unsupported' };

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
  /** A validated graph shared by the phone, or null when sharing stops / the phone disconnects. */
  graph(snapshot: GraphSnapshot | null): void;
}

/**
 * TV side of the companion link. Owns the pairing code lifecycle and is the only
 * place that decides whether a remote device may control this screen.
 */
export class TvSession {
  private state: TvSessionState = { kind: 'idle' };
  private listeners = new Set<(s: TvSessionState) => void>();
  private listener: RemoteListener | null = null;
  private code = '';
  private expiryTimer: unknown = null;
  private failures = 0;
  private channel: RemoteChannel | null = null; // authenticated (pending or connected)
  private seq = new SequenceGuard();
  private assembler = new GraphAssembler();
  private sharing = false;
  private stopped = false;

  constructor(
    private readonly transport: RemoteTransport,
    private readonly sink: TvCommandSink,
    private readonly timers: TimerApi = realTimers,
    private readonly ttlMs: number = PAIRING_TTL_MS,
  ) {}

  getState(): TvSessionState {
    return this.state;
  }

  onState(listener: (s: TvSessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.rotateCode();
  }

  /** Owner approves the pending device. */
  approve(): void {
    if (this.state.kind !== 'pending' || !this.channel) return;
    const device = this.state.device;
    this.clearExpiry();
    this.send({ t: 'approved' });
    this.setState({ kind: 'connected', device });
  }

  /** Owner rejects the pending device; the code is rotated so it cannot simply retry. */
  reject(): void {
    if (this.state.kind !== 'pending' || !this.channel) return;
    this.send({ t: 'rejected' });
    this.dropChannel();
    void this.rotateCode();
  }

  /** End the current phone session (TV side). A fresh code is issued for the next pairing. */
  disconnect(): void {
    if (!this.channel) return;
    this.send({ t: 'ended', reason: 'disconnect' });
    this.afterDisconnect();
  }

  /** Tear everything down (leaving TV mode). Clears any shared graph from memory. */
  stop(): void {
    this.stopped = true;
    if (this.channel) this.send({ t: 'ended', reason: 'exit' });
    this.dropChannel();
    if (this.sharing) this.sink.graph(null);
    this.sharing = false;
    this.clearExpiry();
    this.listener?.close();
    this.listener = null;
    this.setState({ kind: 'idle' });
  }

  sendState(state: Omit<Extract<TvMessage, { t: 'state' }>, 't' | 'source'>): void {
    if (this.state.kind === 'connected') this.send({ t: 'state', ...state, source: this.sharing ? 'phone' : 'local' });
  }

  sendIndex(nodes: Array<{ id: string; title: string; parentId: string | null }>): void {
    if (this.state.kind === 'connected') this.send({ t: 'index', nodes: nodes.slice(0, 5000) });
  }

  // ---------------------------------------------------------------------------

  private async rotateCode(): Promise<void> {
    if (this.stopped) return;
    this.clearExpiry();
    this.listener?.close();
    this.listener = null;
    this.failures = 0;
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
    if (this.channel || this.state.kind !== 'waiting') {
      ch.send({ t: 'busy' } satisfies TvMessage);
      closeSoon(ch);
      return;
    }
    const code = this.code;
    const nonce = randomNonce();
    let device: DeviceKind = 'other';
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
          ch.send({ t: 'challenge', v: PROTOCOL_VERSION, nonce } satisfies TvMessage);
          return;
        }
        // auth
        if (this.state.kind !== 'waiting' || this.code !== code || this.channel) {
          ch.send({ t: 'auth-fail', reason: 'expired' } satisfies TvMessage);
          closeSoon(ch);
          return;
        }
        const ok = await verifyProof(code, nonce, ch.remoteId, msg.proof);
        if (!ok || this.channel || this.code !== code) {
          ch.send({ t: 'auth-fail', reason: ok ? 'expired' : 'bad-proof' } satisfies TvMessage);
          closeSoon(ch);
          if (!ok && ++this.failures >= MAX_AUTH_FAILURES) void this.rotateCode();
          return;
        }
        authed = true;
        this.timers.clearTimeout(authTimer);
        this.channel = ch;
        this.seq = new SequenceGuard();
        ch.send({ t: 'pending' } satisfies TvMessage);
        this.setState({ kind: 'pending', code, device });
        return;
      }
      // Commands are honoured only once the owner approved this channel.
      if (this.state.kind !== 'connected' || this.channel !== ch) return;
      const cmd = parseCommand(raw);
      if (!cmd || !this.seq.accept(cmd.seq)) return;
      this.dispatch(cmd);
    });
    ch.onClose(() => {
      this.timers.clearTimeout(authTimer);
      if (this.channel === ch) this.afterDisconnect();
    });
  }

  private dispatch(cmd: NonNullable<ReturnType<typeof parseCommand>>): void {
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
      case 'graph-chunk': {
        const raw = this.assembler.add(cmd);
        if (raw === null) return;
        const snapshot = fromSharedGraph(raw);
        if (!snapshot) return;
        this.sharing = true;
        return s.graph(snapshot);
      }
      case 'graph-stop':
        if (this.sharing) s.graph(null);
        this.sharing = false;
        return;
      case 'bye':
        return this.afterDisconnect();
    }
  }

  private afterDisconnect(): void {
    this.dropChannel();
    if (this.sharing) this.sink.graph(null); // temporary phone data is discarded immediately
    this.sharing = false;
    if (!this.stopped) void this.rotateCode();
  }

  private dropChannel(): void {
    const ch = this.channel;
    this.channel = null;
    this.assembler = new GraphAssembler();
    if (ch) closeSoon(ch);
  }

  private send(msg: TvMessage): void {
    this.channel?.send(msg);
  }

  private clearExpiry(): void {
    if (this.expiryTimer !== null) this.timers.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private setState(s: TvSessionState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }
}
