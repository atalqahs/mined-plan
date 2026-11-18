import { useEffect, useSyncExternalStore } from 'react';
import type { AppContainer } from '@/app/bootstrap/container';
import { useApp } from '@/app/providers/AppContext';
import { ControllerSession, type ControllerState, type ResumeStore, type ShareStatus, type TvIndex, type TvStateMessage } from '@/application/remote/controllerSession';
import { remoteDiagnostics as diag } from '@/application/remote/diagnostics';
import { describeDevice } from '@/application/remote/pairing';
import type { ControlCommand } from '@/application/remote/protocol';
import { realTimers } from '@/application/remote/types';
import { PeerTransport } from '@/infrastructure/remote/peerTransport';
import { useUi } from '@/presentation/state/uiStore';
import { installLifecycleDiagnostics } from './lifecycle';
import { createWakeLock } from './wakeLock';

export type ShareDecision = 'undecided' | 'share' | 'control-only';

interface Snapshot {
  state: ControllerState;
  tvState: TvStateMessage | null;
  index: TvIndex;
  share: ShareDecision;
  shareStatus: ShareStatus;
}

const RESUME_KEY = 'orbital-mind:tv-resume';
/** Tab-scoped: lets a page that iOS reloaded after a lock resume its approved session (≤ 85 s). */
const sessionResumeStore: ResumeStore = {
  load() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(v) {
    try {
      if (v) sessionStorage.setItem(RESUME_KEY, JSON.stringify(v));
      else sessionStorage.removeItem(RESUME_KEY);
    } catch {
      /* storage unavailable: resume only within this page */
    }
  },
};

/**
 * The phone's companion connection. Lives at module level (not in a component) so it
 * survives switching between the controller screen and the full app: the user can go
 * back to edit ideas while connected, and every change is synced to the TV.
 *
 * The phone's IndexedDB data stays authoritative and is only read here. A display-only
 * copy is sent to the TV only after the user chooses to share.
 */
class ControllerConnection {
  readonly session = new ControllerSession(new PeerTransport(), describeDevice(navigator.userAgent), realTimers, sessionResumeStore);
  readonly wake = createWakeLock();
  private snap: Snapshot = { state: { kind: 'idle' }, tvState: null, index: [], share: 'undecided', shareStatus: { status: 'idle' } };
  private listeners = new Set<() => void>();
  private app: AppContainer | null = null;
  private stopSync: (() => void) | null = null;

  constructor() {
    installLifecycleDiagnostics();
    this.session.onState((state) => {
      const k = state.kind;
      const live = k === 'connected' || k === 'reconnecting' || k === 'awaiting-approval';
      // A transient drop (reconnecting) keeps the user's choices; a real end resets them.
      if (k === 'ended' || k === 'failed' || k === 'idle') this.set({ state, tvState: null, index: [], share: 'undecided', shareStatus: { status: 'idle' } });
      else this.set({ state });
      this.wake.set(live);
      useUi.getState().setTvRemoteLinked(live);
      this.syncSharing();
    });
    this.session.onTvState((tvState) => this.set({ tvState }));
    this.session.onIndex((index) => this.set({ index }));
    this.session.onShare((shareStatus) => this.set({ shareStatus }));

    // Foreground again (unlock / app switch / bfcache restore): resume at once if the link dropped.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.session.wake();
    });
    window.addEventListener('pageshow', () => this.session.wake());
    // A real unload ends the session cleanly (the TV clears its temporary data at once).
    // A bfcache "pagehide" (persisted) is not an unload — keep the session resumable.
    window.addEventListener('pagehide', (e) => {
      if (!(e as PageTransitionEvent).persisted && this.session.getState().kind === 'connected') this.session.disconnect();
    });
    void this.session.resumeSaved();
  }

  attach(app: AppContainer) {
    if (this.app === app) return;
    this.app = app;
    this.syncSharing();
  }

  get = () => this.snap;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  decideShare(d: ShareDecision) {
    if (d !== 'share' && this.snap.share === 'share') this.session.stopSharing();
    diag.log('ctl.share-decision', { share: d });
    this.set({ share: d });
    this.syncSharing();
  }

  retryShare() {
    if (this.snap.share === 'share' && this.app) this.session.shareGraph(this.app.store.getSnapshot());
  }

  /** While sharing and connected: send now, then re-send (debounced) whenever the phone's graph changes. */
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
    wakeLockSupported: conn.wake.supported,
    connect: (code: string) => void conn.session.connect(code),
    send: (cmd: ControlCommand) => conn.session.send(cmd),
    decideShare: (d: ShareDecision) => conn.decideShare(d),
    retryShare: () => conn.retryShare(),
    disconnect: () => conn.session.disconnect(),
  };
}
