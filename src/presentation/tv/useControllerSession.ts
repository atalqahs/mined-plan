import { useEffect, useSyncExternalStore } from 'react';
import type { AppContainer } from '@/app/bootstrap/container';
import { useApp } from '@/app/providers/AppContext';
import { ControllerSession, type ControllerState, type TvIndex, type TvStateMessage } from '@/application/remote/controllerSession';
import { describeDevice } from '@/application/remote/pairing';
import type { ControlCommand } from '@/application/remote/protocol';
import { PeerTransport } from '@/infrastructure/remote/peerTransport';
import { useUi } from '@/presentation/state/uiStore';

export type ShareDecision = 'undecided' | 'share' | 'control-only';

interface Snapshot {
  state: ControllerState;
  tvState: TvStateMessage | null;
  index: TvIndex;
  share: ShareDecision;
}

/**
 * The phone's companion connection. Lives at module level (not in a component) so it
 * survives switching between the controller screen and the full app: the user can go
 * back to edit ideas while connected, and every change is synced to the TV.
 *
 * The phone's IndexedDB data stays authoritative and is only read here. A display-only
 * copy is sent to the TV only after the user chooses to share.
 */
class ControllerConnection {
  readonly session = new ControllerSession(new PeerTransport(), describeDevice(navigator.userAgent));
  private snap: Snapshot = { state: { kind: 'idle' }, tvState: null, index: [], share: 'undecided' };
  private listeners = new Set<() => void>();
  private app: AppContainer | null = null;
  private stopSync: (() => void) | null = null;

  constructor() {
    this.session.onState((state) => {
      const connected = state.kind === 'connected';
      this.set(connected ? { state } : { state, tvState: null, index: [], share: 'undecided' });
      if (!connected) this.syncSharing();
      useUi.getState().setTvRemoteLinked(connected || state.kind === 'awaiting-approval');
    });
    this.session.onTvState((tvState) => this.set({ tvState }));
    this.session.onIndex((index) => this.set({ index }));
    // Tell the TV promptly when this page goes away.
    window.addEventListener('pagehide', () => {
      if (this.session.getState().kind === 'connected') this.session.disconnect();
    });
  }

  attach(app: AppContainer) {
    this.app = app;
  }

  get = () => this.snap;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  decideShare(d: ShareDecision) {
    if (d !== 'share' && this.snap.share === 'share') this.session.stopSharing();
    this.set({ share: d });
    this.syncSharing();
  }

  /** While sharing: send now, then re-send (debounced) whenever the phone's graph changes. */
  private syncSharing() {
    this.stopSync?.();
    this.stopSync = null;
    const store = this.app?.store;
    if (!store || this.snap.state.kind !== 'connected' || this.snap.share !== 'share') return;
    this.session.shareGraph(store.getSnapshot());
    let timer: number | null = null;
    const off = store.subscribe(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => this.session.shareGraph(store.getSnapshot()), 400);
    });
    this.stopSync = () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }
}

let connection: ControllerConnection | null = null;
export function getControllerConnection(): ControllerConnection {
  connection ??= new ControllerConnection();
  return connection;
}

export function useControllerSession() {
  const app = useApp();
  const conn = getControllerConnection();
  useEffect(() => conn.attach(app), [conn, app]);
  const snap = useSyncExternalStore(conn.subscribe, conn.get);
  return {
    ...snap,
    localCount: app.store.getSnapshot().nodes.size,
    connect: (code: string) => void conn.session.connect(code),
    send: (cmd: ControlCommand) => conn.session.send(cmd),
    decideShare: (d: ShareDecision) => conn.decideShare(d),
    disconnect: () => conn.session.disconnect(),
  };
}
