import { useEffect, useRef, useState } from 'react';
import type { AppContainer } from '@/app/bootstrap/container';
import { createContainer } from '@/app/bootstrap/container';
import type { GraphSnapshot } from '@/domain/entities/types';
import { TvSession, type TvCommandSink, type TvSessionState } from '@/application/remote/tvSession';
import { PeerTransport } from '@/infrastructure/remote/peerTransport';
import { sceneRuntime } from '@/presentation/scene3d/runtime';
import { useUi } from '@/presentation/state/uiStore';
import { t } from '@/presentation/i18n/ar';
import { installLifecycleDiagnostics } from './lifecycle';
import { createWakeLock } from './wakeLock';

/**
 * Presentation-side wiring of the TV session:
 *  - authenticated phone commands → camera API + UI state,
 *  - a shared phone graph → a temporary, in-memory AppContainer (never IndexedDB),
 *  - TV state + displayed index → back to the phone.
 */
export function useTvSession(localContainer: AppContainer) {
  const [state, setState] = useState<TvSessionState>({ kind: 'idle' });
  const [remote, setRemote] = useState<AppContainer | null>(null);
  const sessionRef = useRef<TvSession | null>(null);
  const remoteRef = useRef<AppContainer | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const ui = () => useUi.getState();

    const applyGraph = async (snapshot: GraphSnapshot | null) => {
      if (!snapshot) {
        // Phone stopped sharing or disconnected: drop the temporary copy from memory.
        remoteRef.current = null;
        setRemote(null);
        ui().exitFocus();
        ui().select(null);
        ui().requestCamera({ kind: 'reset' });
        return;
      }
      const before = sceneRuntime.rendered;
      let c = remoteRef.current;
      const first = !c;
      if (!c) c = await createContainer({ ephemeral: true });
      if (!alive) return;
      c.store.hydrateEphemeral(snapshot);
      if (first) {
        remoteRef.current = c;
        setRemote(c);
        ui().select(null);
        setTimeout(() => useUi.getState().requestCamera({ kind: 'reset' }), 60);
      }
      // Resolve once the scene has picked up the new graph, so the phone hears "shown" only when it is.
      await new Promise<void>((resolve) => {
        const until = performance.now() + 1500;
        const check = () => (sceneRuntime.rendered !== before || performance.now() > until ? requestAnimationFrame(() => resolve()) : requestAnimationFrame(check));
        requestAnimationFrame(check);
      });
    };

    const sink: TvCommandSink = {
      orbit: (az, pol) => sceneRuntime.camera?.rotate(az, pol),
      zoom: (f) => sceneRuntime.camera?.zoom(f),
      reset: () => {
        ui().exitFocus();
        sceneRuntime.camera?.reset();
      },
      select: (id) => ui().select(id, { fly: !!id, open: false }),
      focus: (on, level) => {
        if (!on) return ui().exitFocus();
        if (level) ui().setFocusLevel(level);
        if (!ui().focus.active) ui().enterFocus(level);
      },
      primaryOnly: (on) => ui().setPrimaryOnly(on),
      toolbar: (visible) => ui().setTvToolbar(visible),
      exitTv: () => ui().setTvMode('off'),
      graph: (g) => applyGraph(g),
    };

    installLifecycleDiagnostics();
    const wake = createWakeLock();
    const session = new TvSession(new PeerTransport(), sink);
    sessionRef.current = session;
    let prev: TvSessionState['kind'] = 'idle';
    const off = session.onState((s) => {
      setState(s);
      if (s.kind === 'connected' && prev === 'pending') ui().toast({ message: t.tv.phoneConnected(t.tv.devices[s.device] ?? t.tv.devices.other), tone: 'success', duration: 3500 });
      // Keep the TV awake while a phone session exists (Android TV screensaver / sleep).
      wake.set(s.kind === 'connected' || s.kind === 'reconnecting' || s.kind === 'pending');
      prev = s.kind;
    });
    const offEvents = session.onEvent((e) => {
      if (e.type === 'phone-left') ui().toast({ message: t.tv.phoneDisconnected, duration: 4000 });
      else if (e.type === 'phone-lost') ui().toast({ message: t.tv.phoneLost, duration: 5000 });
      else if (e.type === 'resumed') ui().toast({ message: t.tv.phoneResumed, tone: 'success', duration: 3000 });
      else if (e.type === 'grace-expired') ui().toast({ message: t.tv.phoneGraceExpired, duration: 5000 });
      else if (e.type === 'graph-failed') ui().toast({ message: t.tv.graphFailedTv, duration: 5000 });
    });
    void session.start();
    return () => {
      alive = false;
      off();
      offEvents();
      wake.dispose();
      session.stop();
      sessionRef.current = null;
      remoteRef.current = null;
    };
  }, [attempt]);

  // TV → phone: UI state (selection, focus, overview filter, toolbar).
  useEffect(() => {
    let last = '';
    const push = () => {
      const s = useUi.getState();
      const msg = { selectedId: s.selectedId, focus: s.focus.active, level: s.focus.level, primaryOnly: s.primaryOnly, toolbar: s.tv.toolbarVisible };
      const key = JSON.stringify(msg);
      if (key === last) return;
      last = key;
      sessionRef.current?.sendState(msg);
    };
    push();
    const off = useUi.subscribe(push);
    const resend = () => {
      last = '';
      push();
    };
    // Re-send when a phone (re)connects.
    if (state.kind === 'connected') resend();
    return off;
  }, [state.kind]);

  // TV → phone: titles of the displayed network (for the phone's idea picker).
  const display = remote ?? localContainer;
  useEffect(() => {
    if (state.kind !== 'connected') return;
    const send = () => {
      const nodes = [...display.store.getSnapshot().nodes.values()].map((n) => ({ id: n.id, title: n.title, parentId: n.parentId }));
      sessionRef.current?.sendIndex(nodes);
    };
    send();
    return display.store.subscribe(send);
  }, [display, state.kind]);

  return {
    state,
    remote,
    approve: () => sessionRef.current?.approve(),
    reject: () => sessionRef.current?.reject(),
    disconnect: () => sessionRef.current?.disconnect(),
    retry: () => setAttempt((n) => n + 1),
  };
}
