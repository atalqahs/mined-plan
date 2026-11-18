import type { GraphSnapshot } from '@/domain/entities/types';
import { chunkGraph, toSharedGraph } from './graphShare';
import { computeProof, normalizePairingCode, peerIdForCode, PROTOCOL_VERSION, randomNonce } from './pairing';
import { parseTvMessage, type ControlCommand, type TvMessage } from './protocol';
import { realTimers, TransportError, type DeviceKind, type RemoteChannel, type RemoteTransport, type TimerApi } from './types';
// Handshake: phone → hello; TV → challenge(nonce); phone → auth(HMAC proof); TV → pending → (owner) approved | rejected.

export type ControllerFailure = 'invalid-code' | 'not-found' | 'bad-code' | 'expired' | 'rejected' | 'busy' | 'timeout' | 'network' | 'version' | 'unsupported';

export type ControllerState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'awaiting-approval' }
  | { kind: 'connected' }
  | { kind: 'failed'; reason: ControllerFailure }
  | { kind: 'ended'; reason: 'exit' | 'disconnect' | 'closed' };

export type TvStateMessage = Extract<TvMessage, { t: 'state' }>;
export type TvIndex = Extract<TvMessage, { t: 'index' }>['nodes'];

const CONNECT_TIMEOUT_MS = 20_000;

/**
 * Phone side of the companion link: authenticates against the TV, then sends
 * sequenced control commands and (only with the user's consent) a display-only
 * snapshot of the phone's own graph. The phone never receives or stores TV data
 * beyond a lightweight list of titles for picking an idea.
 */
export class ControllerSession {
  private state: ControllerState = { kind: 'idle' };
  private listeners = new Set<(s: ControllerState) => void>();
  private tvStateListeners = new Set<(s: TvStateMessage) => void>();
  private indexListeners = new Set<(nodes: TvIndex) => void>();
  private channel: RemoteChannel | null = null;
  private seq = 0;

  constructor(
    private readonly transport: RemoteTransport,
    private readonly device: DeviceKind,
    private readonly timers: TimerApi = realTimers,
  ) {}

  getState(): ControllerState {
    return this.state;
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

  async connect(codeInput: string): Promise<void> {
    const code = normalizePairingCode(codeInput);
    if (!code) return this.setState({ kind: 'failed', reason: 'invalid-code' });
    this.close();
    this.seq = 0;
    this.setState({ kind: 'connecting' });
    let ch: RemoteChannel;
    try {
      ch = await this.transport.connect(await peerIdForCode(code));
    } catch (e) {
      const reason: ControllerFailure = e instanceof TransportError ? (e.code === 'peer-not-found' ? 'not-found' : e.code === 'timeout' ? 'timeout' : e.code === 'unsupported' ? 'unsupported' : 'network') : 'unsupported';
      return this.setState({ kind: 'failed', reason });
    }
    this.channel = ch;
    let challenged = false;
    const timer = this.timers.setTimeout(() => {
      if (!challenged && this.channel === ch) {
        this.close();
        this.setState({ kind: 'failed', reason: 'timeout' });
      }
    }, CONNECT_TIMEOUT_MS);

    ch.onMessage(async (raw) => {
      if (this.channel !== ch) return;
      const msg = parseTvMessage(raw);
      if (!msg) return;
      switch (msg.t) {
        case 'challenge': {
          challenged = true;
          this.timers.clearTimeout(timer);
          if (msg.v !== PROTOCOL_VERSION) {
            this.close();
            return this.setState({ kind: 'failed', reason: 'version' });
          }
          ch.send({ t: 'auth', proof: await computeProof(code, msg.nonce, ch.localId) });
          return;
        }
        case 'pending':
          return this.setState({ kind: 'awaiting-approval' });
        case 'approved':
          return this.setState({ kind: 'connected' });
        case 'rejected':
          this.close();
          return this.setState({ kind: 'failed', reason: 'rejected' });
        case 'busy':
          this.close();
          return this.setState({ kind: 'failed', reason: 'busy' });
        case 'auth-fail':
          this.close();
          return this.setState({ kind: 'failed', reason: msg.reason === 'bad-proof' ? 'bad-code' : msg.reason === 'version' ? 'version' : msg.reason === 'timeout' ? 'timeout' : 'expired' });
        case 'ended':
          this.close();
          return this.setState({ kind: 'ended', reason: msg.reason });
        case 'state':
          if (this.state.kind === 'connected') for (const l of this.tvStateListeners) l(msg);
          return;
        case 'index':
          if (this.state.kind === 'connected') for (const l of this.indexListeners) l(msg.nodes);
          return;
      }
    });
    ch.send({ t: 'hello', v: PROTOCOL_VERSION, device: this.device });
    ch.onClose(() => {
      if (this.channel !== ch) return;
      this.channel = null;
      if (this.state.kind === 'connected' || this.state.kind === 'awaiting-approval' || this.state.kind === 'connecting') this.setState({ kind: 'ended', reason: 'closed' });
    });
  }

  send(cmd: ControlCommand): boolean {
    if (this.state.kind !== 'connected' || !this.channel) return false;
    this.channel.send({ ...cmd, seq: ++this.seq });
    return true;
  }

  /** Send a display-only copy of the phone's graph (requires the user's consent in the UI). */
  shareGraph(snapshot: GraphSnapshot): boolean {
    if (this.state.kind !== 'connected') return false;
    const gid = randomNonce(8);
    for (const chunk of chunkGraph(toSharedGraph(snapshot), gid)) this.send(chunk);
    return true;
  }

  stopSharing(): void {
    this.send({ t: 'graph-stop' });
  }

  disconnect(): void {
    if (this.state.kind === 'connected') this.send({ t: 'bye' });
    this.close();
    this.setState({ kind: 'ended', reason: 'disconnect' });
  }

  private close(): void {
    const ch = this.channel;
    this.channel = null;
    if (ch) setTimeout(() => ch.close(), 80);
  }

  private setState(s: ControllerState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }
}
