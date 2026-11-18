import { useEffect, useMemo, useRef, useState } from 'react';
import { AppProvider, useApp } from '@/app/providers/AppContext';
import { SceneContainer } from '@/presentation/scene3d/SceneContainer';
import { sceneRuntime } from '@/presentation/scene3d/runtime';
import { useUi } from '@/presentation/state/uiStore';
import { Toasts } from '@/presentation/ui/Toasts';
import { t } from '@/presentation/i18n/ar';
import { useTvSession } from './useTvSession';
import { useTvRemoteKeys } from './useTvRemoteKeys';
import { PairingCard } from './PairingCard';
import { ApprovalPrompt } from './ApprovalPrompt';
import { TvToolbar } from './TvToolbar';
import { exitFullscreen } from './fullscreen';
import styles from './Tv.module.css';
import '@/presentation/ui/labels.css';

/**
 * Immersive television presentation. Renders the live Three.js scene at this
 * display's own resolution and aspect (16:9 composition profile), with all
 * application chrome hidden. Only the brain, the orbiting ideas, their links
 * and the atmosphere remain until the toolbar is explicitly revealed.
 */
export default function TvPresentation() {
  const local = useApp();
  const tv = useTvSession(local);
  const toolbarVisible = useUi((s) => s.tv.toolbarVisible);
  const [pairingHidden, setPairingHidden] = useState(false);
  useTvRemoteKeys();

  useEffect(() => {
    document.documentElement.dataset.tv = 'present';
    return () => {
      delete document.documentElement.dataset.tv;
      void exitFullscreen();
    };
  }, []);

  // Hide the pairing card once a phone is connected; show it again (with the fresh code) after it disconnects.
  const prevKind = useRef(tv.state.kind);
  useEffect(() => {
    // A transient drop ('reconnecting') keeps the session: the card stays hidden while the phone resumes.
    const live = (k: string) => k === 'connected' || k === 'reconnecting';
    if (tv.state.kind === 'connected') setPairingHidden(true);
    if (live(prevKind.current) && !live(tv.state.kind)) setPairingHidden(false);
    prevKind.current = tv.state.kind;
  }, [tv.state.kind]);

  const data = tv.remote ?? local;
  const showPairing = !pairingHidden && (tv.state.kind === 'waiting' || tv.state.kind === 'starting' || tv.state.kind === 'error');
  const source = tv.remote ? 'phone' : 'local';

  const toolbar = useMemo(
    () => (
      <TvToolbar
        connected={tv.state.kind === 'connected' || tv.state.kind === 'reconnecting'}
        reconnecting={tv.state.kind === 'reconnecting'}
        device={tv.state.kind === 'connected' || tv.state.kind === 'reconnecting' ? tv.state.device : null}
        source={source}
        onPair={() => setPairingHidden(false)}
        onDisconnect={tv.disconnect}
      />
    ),
    [tv.state, source, tv.disconnect],
  );

  return (
    <div className={styles.tv} data-testid="tv-presentation" data-source={source} data-toolbar={toolbarVisible ? 'shown' : 'hidden'}>
      <AppProvider container={data}>
        <main className={styles.stage} aria-label={t.scene.canvasLabel}>
          <SceneContainer />
          <div
            className={styles.labels}
            aria-hidden="true"
            ref={(el) => {
              sceneRuntime.labelHost = el;
            }}
          />
          <div className={styles.vignette} aria-hidden="true" />
        </main>
      </AppProvider>
      <div className={styles.chrome} data-visible={toolbarVisible}>
        {toolbarVisible ? toolbar : null}
      </div>
      {showPairing ? <PairingCard state={tv.state} onDismiss={() => setPairingHidden(true)} onRetry={tv.retry} /> : null}
      {tv.state.kind === 'pending' ? <ApprovalPrompt device={tv.state.device} onAllow={tv.approve} onReject={tv.reject} /> : null}
      <Toasts />
    </div>
  );
}
