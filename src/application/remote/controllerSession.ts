import type { GraphSnapshot } from '@/domain/entities/types';
import { remoteDiagnostics as diag } from './diagnostics';
import { buildGraphParts, toSharedGraph, type GraphPart } from './graphShare';
import { computeProof, normalizePairingCode, peerIdForCode, PROTOCOL_VERSION, randomNonce } from './pairing';
import { parseTvMessage, type ControlCommand, type TvMessage } from './protocol';
import { realTimers, TransportError, type ChannelCloseReason, type DeviceKind, type RemoteChannel, type RemoteTransport, type TimerApi } from './types';

export type ControllerFailure = 'invalid-code' | 'not-found' | 'bad-code' | 'expired' | 'rejected' | 'busy' | 'timeout' | 'network' | 'version' | 'unsupported';
/** Why a session ended. 'user' = this phone disconnected; 'disconnect'/'exit' = the TV ended it; 'lost' = could not resume. */
export type EndReason = 'exit' | 'disconnect' | 'user' | 'lost';

export type ControllerState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'awaiting-approval' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number; cause: ChannelCloseReason | 'silent' }
  | { kind: 'failed'; reason: ControllerFailure }
  | { kind: 'ended'; reason: EndReason };

export type TvStateMessage = Extract<TvMessage, { t: 'state' }>;
export type TvIndex = Array<{ id: string; title: string; parentId: string | null }>;

export type ShareStatus =
  | { status: 'idle' }
  | { status: 'sending'; sent: number; total: number }
  | { status: 'shown'; nodes: number; edges: number }
  | { status: 'failed'; reason: 'timeout' | 'rejected-by-tv' | 'too-large' | 'connection' };

/** Survives a page reload within the tab (sessionStorage in the browser). */
export interface ResumeStore {
  load(): { code: string; token: string; until: number } | null;
  save(v: { code: string; token: string; until: number } | null): void;
}
const memoryStore = (): ResumeStore => {
  let v: { code: string; token: string; until: number } | null = null;
  return { load: () => v, save: (x) => void (v = x) };
};

export interface ControllerOptions {
  /** Silence from the TV (no ping or other message) after which the link is treated as lost. */
  silenceMs?: number;
  /** How long to keep trying to resume after an unexpected drop (≤ the TV's grace period). */
  resumeWindowMs?: number;
  /** Max unacknowledged graph parts in flight. */
  window?: number;
  /** Abort a transfer if no acknowledgement arrives for this long. */
  stallMs?: number;
  /** Pause sending while the channel holds more than this many bytes. */
  highWaterBytes?: number;
}

const CONNECT_TIMEOUT_MS = 20_000;
const RESUME_DELAYS = [500, 1500, 3000, 5000, 8000, 12_000, 15_000];

/**
 * Phone side of the companion link: authenticates against the TV, sends sequenced
 * control commands, transfers a display-only graph with pacing and acknowledgements,
 * and transparently resumes an approved session after a transient drop.
 */
export class ControllerSession {
  private state: ControllerState = { kind: 'idle' };
  private listeners = new Set<(s: ControllerState) => void>();
  private tvStateListeners = new Set<(s: TvStateMessage) => void>();
  private indexListeners = new Set<(nodes: TvIndex) => void>();
  private shareListeners = new Set<(s: ShareStatus) => void>();
  private channel: RemoteChannel | null = null;
  private seq = 0;
  private code: string | null = null;
  private token: string | null = null;
  private lastSeen = 0;
  private watchdog: unknown = null;
  private resumeTimer: unknown = null;
  private resumeDeadline = 0;
  private resumeAttempt = 0;
  private indexPages: { gid: string; pages: TvIndex[]; got: number } | null = null;
  private share: ShareStatus = { status: 'idle' };
  private transfer: { gid: string; parts: GraphPart[]; next: number; acked: Set<number>; inflight: number; stall: unknown; pump: unknown } | null = null;
  private readonly silenceMs: number;
  private readonly resumeWindowMs: number;
  private readonly window: number;
  private readonly stallMs: number;
  private readonly highWater: number;

  constructor(
    private readonly transport: RemoteTransport,
    private readonly device: DeviceKind,
    private readonly timers: TimerApi = realTimers,
    private readonly resumeStore: ResumeStore = memoryStore(),
    options: ControllerOptions = {},
  ) {
    this.silenceMs = options.silenceMs ?? 25_000;
    this.resumeWindowMs = options.resumeWindowMs ?? 85_000;
    this.window = options.window ?? 4;
    this.stallMs = options.stallMs ?? 15_000;
    this.highWater = options.highWaterBytes ?? 256 * 1024;
  }

  getState(): ControllerState {
    return this.state;
  }
  getShareStatus(): ShareStatus {
    return this.share;
  }
  onState(l: (s: ControllerState) => void): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }
  onTvState(l: (s: TvStateMessage) => void): () => void {
    this.tvStateListeners.add(l);
    return () => this.tvStateListeners.delete(l);
  }
  onIndex(l: (n: TvIndex) => void): () => void {
    this.indexListeners.add(l);
    return () => this.indexListeners.delete(l);
  }
  onShare(l: (s: ShareStatus) => void): () => void {
    this.shareListeners.add(l);
    return () => this.shareListeners.delete(l);
  }

  /** New pairing (user typed / scanned a code). */
  async connect(codeInput: string): Promise<void> {
    const code = normalizePairingCode(codeInput);
    if (!code) return this.setState({ kind: 'failed', reason: 'invalid-code' });
    this.stopResume();
    this.closeChannel();
    this.code = code;
    this.token = null;
    this.resumeStore.save(null);
    this.setState({ kind: 'connecting' });
    const result = await this.open(code, undefined);
    if (result !== 'ok') this.setState({ kind: 'failed', reason: result });
  }

  /** Try to resume a session saved before this page was reloaded (same tab). */
  async resumeSaved(): Promise<boolean> {
    const saved = this.resumeStore.load();
    if (!saved || saved.until < this.timers.now()) {
      this.resumeStore.save(null);
      return false;
    }
    this.code = saved.code;
    this.token = saved.token;
    diag.log('ctl.resume-saved');
    this.beginResume('remote');
    return true;
  }

  /** Called when the page becomes visible again (e.g. iPhone unlocked): resume immediately if needed. */
  wake(): void {
    if (this.state.kind === 'reconnecting') {
      diag.log('ctl.wake');
      this.timers.clearTimeout(this.resumeTimer);
      void this.resumeStep();
    } else if (this.state.kind === 'connected' && this.timers.now() - this.lastSeen > this.silenceMs) {
      this.lost('silent');
    }
  }

  send(cmd: ControlCommand): boolean {
    if (this.state.kind !== 'connected' || !this.channel) return false;
    const ok = this.channel.send({ ...cmd, seq: ++this.seq });
    if (!ok) diag.log('ctl.send-refused', { type: cmd.t });
    return ok;
  }

  /**
   * Transfer a display-only copy of the phone's graph (requires the user's consent in the UI).
   * Supersedes any unfinished transfer. Reports `shown` only after the TV validated it.
   */
  shareGraph(snapshot: GraphSnapshot): void {
    if (this.state.kind !== 'connected') return;
    this.abortTransfer(true);
    let parts: GraphPart[];
    try {
      parts = buildGraphParts(toSharedGraph(snapshot));
    } catch {
      return this.setShare({ status: 'failed', reason: 'too-large' });
    }
    const gid = randomNonce(8);
    const nodes = parts.reduce((n, p) => n + p.nodes.length, 0);
    const edges = parts.reduce((n, p) => n + p.edges.length, 0);
    this.transfer = { gid, parts, next: 0, acked: new Set(), inflight: 0, stall: null, pump: null };
    diag.log('ctl.graph-begin', { parts: parts.length, nodes, edges });
    this.send({ t: 'graph-begin', gid, parts: parts.length, nodes, edges });
    this.setShare({ status: 'sending', sent: 0, total: parts.length });
    this.armStall();
    this.pump();
  }

  stopSharing(): void {
    this.abortTransfer(true);
    this.send({ t: 'graph-stop' });
    this.setShare({ status: 'idle' });
  }

  disconnect(): void {
    this.stopResume();
    if (this.state.kind === 'connected') this.send({ t: 'bye' });
    diag.log('ctl.disconnect', { by: 'user' });
    this.forget();
    this.closeChannel();
    this.setState({ kind: 'ended', reason: 'user' });
  }

  // ---------------------------------------------------------------------------

  /** Open + authenticate one channel. Resolves when approved/pending (ok) or with a failure. */
  private open(code: string, resume: string | undefined): Promise<'ok' | ControllerFailure> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: 'ok' | ControllerFailure) => {
        if (done) return;
        done = true;
        resolve(r);
      };
      // After 'pending' the promise is settled; a later refusal must still surface as a failure.
      const fail = (r: ControllerFailure) => {
        if (!done) return finish(r);
        if (this.state.kind === 'awaiting-approval') this.setState({ kind: 'failed', reason: r });
      };
      void (async () => {
        let ch: RemoteChannel;
        try {
          ch = await this.transport.connect(await peerIdForCode(code));
        } catch (e) {
          const reason: ControllerFailure = e instanceof TransportError ? (e.code === 'peer-not-found' ? 'not-found' : e.code === 'timeout' ? 'timeout' : e.code === 'unsupported' ? 'unsupported' : 'network') : 'unsupported';
          diag.log('ctl.connect-fail', { reason });
          return finish(reason);
        }
        this.channel = ch;
        let challenged = false;
        const timer = this.timers.setTimeout(() => {
          if (!challenged && this.channel === ch) {
            this.closeChannel();
            finish('timeout');
          }
        }, CONNECT_TIMEOUT_MS);

        ch.onMessage(async (raw) => {
          if (this.channel !== ch) return;
          this.lastSeen = this.timers.now();
          const msg = parseTvMessage(raw);
          if (!msg) return;
          switch (msg.t) {
            case 'challenge':
              challenged = true;
              this.timers.clearTimeout(timer);
              if (msg.v !== PROTOCOL_VERSION) {
                this.closeChannel();
                return finish('version');
              }
              ch.send({ t: 'auth', proof: await computeProof(code, msg.nonce, ch.localId) });
              return;
            case 'pending':
              this.setState({ kind: 'awaiting-approval' });
              return finish('ok');
            case 'approved':
              this.token = msg.resume;
              this.resumeStore.save({ code, token: msg.resume, until: this.timers.now() + this.resumeWindowMs });
              this.seq = 0;
              this.stopResume();
              diag.log('ctl.approved', { resumed: msg.resumed });
              this.setState({ kind: 'connected' });
              this.startWatchdog();
              return finish('ok');
            case 'rejected':
              this.forget();
              this.closeChannel();
              return fail('rejected');
            case 'busy':
              this.closeChannel();
              return fail('busy');
            case 'auth-fail':
              this.closeChannel();
              return fail(msg.reason === 'bad-proof' ? 'bad-code' : msg.reason === 'version' ? 'version' : msg.reason === 'timeout' ? 'timeout' : 'expired');
            case 'ended':
              diag.log('ctl.ended-by-tv', { reason: msg.reason });
              this.forget();
              this.abortTransfer(false);
              this.closeChannel();
              this.setState({ kind: 'ended', reason: msg.reason });
              return;
            case 'ping':
              this.send({ t: 'pong', n: msg.n });
              return;
            case 'state':
              if (this.state.kind === 'connected') for (const l of this.tvStateListeners) l(msg);
              return;
            case 'index':
              return this.onIndexPage(msg);
            case 'graph-ack':
              return this.onAck(msg.gid, msg.i);
            case 'graph-done':
              if (this.transfer?.gid !== msg.gid) return;
              this.clearTransferTimers();
              this.transfer = null;
              diag.log('ctl.graph-shown', { nodes: msg.nodes, edges: msg.edges });
              this.setShare({ status: 'shown', nodes: msg.nodes, edges: msg.edges });
              return;
            case 'graph-error':
              if (this.transfer?.gid !== msg.gid) return;
              diag.log('ctl.graph-failed', { reason: msg.reason });
              this.abortTransfer(false);
              this.setShare({ status: 'failed', reason: msg.reason === 'too-large' ? 'too-large' : 'rejected-by-tv' });
              return;
          }
        });
        ch.onClose((reason) => {
          this.timers.clearTimeout(timer);
          if (this.channel !== ch) return;
          this.channel = null;
          if (!done) return finish('network');
          if (this.state.kind === 'connected' || this.state.kind === 'awaiting-approval') this.lost(reason);
        });
        ch.send({ t: 'hello', v: PROTOCOL_VERSION, device: this.device, ...(resume ? { resume } : {}) });
      })();
    });
  }

  /** The channel dropped (or went silent) unexpectedly. */
  private lost(cause: ChannelCloseReason | 'silent'): void {
    const wasApproved = this.state.kind === 'connected' && !!this.token;
    this.stopWatchdog();
    if (this.transfer) {
      this.abortTransfer(false);
      this.setShare({ status: 'failed', reason: 'connection' });
    }
    this.closeChannel();
    diag.log('ctl.lost', { cause, resumable: wasApproved });
    if (!wasApproved) return this.setState({ kind: 'ended', reason: 'lost' });
    this.beginResume(cause);
  }

  private beginResume(cause: ChannelCloseReason | 'silent') {
    this.resumeDeadline = this.timers.now() + this.resumeWindowMs;
    this.resumeAttempt = 0;
    this.setState({ kind: 'reconnecting', attempt: 0, cause });
    this.resumeTimer = this.timers.setTimeout(() => void this.resumeStep(), RESUME_DELAYS[0]);
  }

  private async resumeStep(): Promise<void> {
    if (this.state.kind !== 'reconnecting' || !this.code || !this.token) return;
    if (this.timers.now() > this.resumeDeadline) {
      diag.log('ctl.resume-gave-up', { attempts: this.resumeAttempt });
      this.forget();
      return this.setState({ kind: 'ended', reason: 'lost' });
    }
    const attempt = ++this.resumeAttempt;
    this.setState({ kind: 'reconnecting', attempt, cause: this.state.cause });
    diag.log('ctl.resume-try', { attempt });
    const r = await this.open(this.code, this.token);
    if (r === 'ok' || this.state.kind !== 'reconnecting') return;
    diag.log('ctl.resume-fail', { attempt, reason: r });
    if (r === 'rejected' || r === 'version') {
      this.forget();
      return this.setState({ kind: 'ended', reason: 'lost' });
    }
    const delay = RESUME_DELAYS[Math.min(attempt, RESUME_DELAYS.length - 1)];
    this.resumeTimer = this.timers.setTimeout(() => void this.resumeStep(), delay);
  }

  private stopResume(): void {
    if (this.resumeTimer !== null) this.timers.clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.lastSeen = this.timers.now();
    const check = () => {
      if (this.state.kind !== 'connected') return;
      const silent = this.timers.now() - this.lastSeen;
      if (silent > this.silenceMs) {
        diag.log('ctl.silence', { ms: silent });
        return this.lost('silent');
      }
      this.watchdog = this.timers.setTimeout(check, 2000);
    };
    this.watchdog = this.timers.setTimeout(check, 2000);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) this.timers.clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  // --- graph transfer --------------------------------------------------------

  private pump(): void {
    const tr = this.transfer;
    if (!tr || !this.channel || this.state.kind !== 'connected') return;
    if (tr.pump !== null) {
      this.timers.clearTimeout(tr.pump);
      tr.pump = null;
    }
    while (tr.inflight < this.window && tr.next < tr.parts.length) {
      if (this.channel.bufferedAmount() > this.highWater) {
        // Backpressure: let the channel drain before queueing more.
        tr.pump = this.timers.setTimeout(() => this.pump(), 50);
        return;
      }
      const i = tr.next;
      const part = tr.parts[i];
      if (!this.send({ t: 'graph-part', gid: tr.gid, i, nodes: part.nodes, edges: part.edges })) {
        diag.log('ctl.graph-send-fail', { i });
        this.abortTransfer(true);
        return this.setShare({ status: 'failed', reason: 'connection' });
      }
      tr.next++;
      tr.inflight++;
    }
  }

  private onAck(gid: string, i: number): void {
    const tr = this.transfer;
    if (!tr || tr.gid !== gid || tr.acked.has(i)) return;
    tr.acked.add(i);
    tr.inflight = Math.max(0, tr.inflight - 1);
    this.setShare({ status: 'sending', sent: tr.acked.size, total: tr.parts.length });
    this.armStall();
    this.pump();
  }

  private armStall(): void {
    const tr = this.transfer;
    if (!tr) return;
    if (tr.stall !== null) this.timers.clearTimeout(tr.stall);
    tr.stall = this.timers.setTimeout(() => {
      if (this.transfer !== tr) return;
      diag.log('ctl.graph-stalled', { acked: tr.acked.size, total: tr.parts.length });
      this.abortTransfer(true);
      this.setShare({ status: 'failed', reason: 'timeout' });
    }, this.stallMs);
  }

  private clearTransferTimers(): void {
    const tr = this.transfer;
    if (!tr) return;
    if (tr.stall !== null) this.timers.clearTimeout(tr.stall);
    if (tr.pump !== null) this.timers.clearTimeout(tr.pump);
  }

  private abortTransfer(notifyTv: boolean): void {
    const tr = this.transfer;
    if (!tr) return;
    this.clearTransferTimers();
    this.transfer = null;
    if (notifyTv) this.send({ t: 'graph-abort', gid: tr.gid });
  }

  private onIndexPage(msg: Extract<TvMessage, { t: 'index' }>): void {
    if (this.state.kind !== 'connected') return;
    if (!this.indexPages || this.indexPages.gid !== msg.gid) this.indexPages = { gid: msg.gid, pages: new Array(msg.n), got: 0 };
    const acc = this.indexPages;
    if (acc.pages.length !== msg.n) return;
    if (!acc.pages[msg.i]) acc.got++;
    acc.pages[msg.i] = msg.nodes;
    if (acc.got < msg.n) return;
    this.indexPages = null;
    const nodes = acc.pages.flat();
    for (const l of this.indexListeners) l(nodes);
  }

  // ---------------------------------------------------------------------------

  private forget(): void {
    this.token = null;
    this.resumeStore.save(null);
    this.stopWatchdog();
  }

  private closeChannel(): void {
    const ch = this.channel;
    this.channel = null;
    if (ch) setTimeout(() => ch.close(), 80);
  }

  private setShare(s: ShareStatus): void {
    this.share = s;
    for (const l of this.shareListeners) l(s);
  }

  private setState(s: ControllerState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }
}
