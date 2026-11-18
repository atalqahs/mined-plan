import { useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { BrandMark } from '@/presentation/ui/BrandMark';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import { sceneRuntime } from '@/presentation/scene3d/runtime';
import { fullscreenSupported, isFullscreen, requestFullscreen } from './fullscreen';
import styles from './Tv.module.css';

interface Props {
  connected: boolean;
  device: string | null;
  source: 'local' | 'phone';
  onPair(): void;
  onDisconnect(): void;
}

/** The presentation's own toolbar: view controls and session controls only (data stays read-only on the TV). */
export function TvToolbar({ connected, device, source, onPair, onDisconnect }: Props) {
  const focus = useUi((s) => s.focus);
  const hasSelection = useUi((s) => s.selectedId !== null);
  const primaryOnly = useUi((s) => s.primaryOnly);
  const first = useRef<HTMLButtonElement>(null);
  const [fs, setFs] = useState(isFullscreen());
  useEffect(() => {
    first.current?.focus({ preventScroll: true }); // D-pad starts on the toolbar
    const on = () => setFs(isFullscreen());
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const ui = () => useUi.getState();
  return (
    <header className={styles.toolbar} data-tv-toolbar="" aria-label={t.tv.toolbarLabel} data-testid="tv-toolbar">
      <div className={styles.brand}>
        <BrandMark />
        <span>{t.appName}</span>
        <span className={styles.source} data-testid="tv-source">
          {source === 'phone' ? t.tv.sourcePhone : t.tv.sourceLocal}
        </span>
      </div>
      <div className={styles.tools}>
        <Button ref={first} icon="focus" aria-pressed={focus.active} disabled={!hasSelection && !focus.active} onClick={() => (focus.active ? ui().exitFocus() : ui().enterFocus())}>
          {t.toolbar.focus}
        </Button>
        {focus.active ? (
          <Button size="sm" onClick={() => ui().setFocusLevel(focus.level === 1 ? 2 : 1)}>
            {focus.level === 1 ? t.focus.direct : t.focus.extended}
          </Button>
        ) : null}
        <Button icon="orbit" aria-pressed={primaryOnly} onClick={() => ui().setPrimaryOnly(!primaryOnly)} data-testid="tv-primary-only">
          {t.overview.toggle}
        </Button>
        <Button icon="home" onClick={() => sceneRuntime.camera?.reset()}>
          {t.toolbar.resetView}
        </Button>
        {connected ? (
          <Button icon="phone" onClick={onDisconnect} data-testid="tv-disconnect">
            {`${t.tv.disconnect} (${t.tv.devices[device ?? 'other'] ?? t.tv.devices.other})`}
          </Button>
        ) : (
          <Button icon="phone" onClick={onPair} data-testid="tv-pair">
            {t.tv.pairPhone}
          </Button>
        )}
        {fullscreenSupported() && !fs ? (
          <Button icon="expand" onClick={() => void requestFullscreen()}>
            {t.tv.fullscreen}
          </Button>
        ) : null}
        <Button icon="close" variant="quiet" onClick={() => ui().setTvToolbar(false)} data-testid="tv-hide-toolbar">
          {t.tv.hideToolbar}
        </Button>
        <Button icon="exit" variant="danger" onClick={() => ui().setTvMode('off')} data-testid="tv-exit">
          {t.tv.exit}
        </Button>
      </div>
      <p className={styles.hint}>{t.tv.toolbarHint}</p>
    </header>
  );
}
