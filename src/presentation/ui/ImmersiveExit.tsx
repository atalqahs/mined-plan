import { useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import styles from './Workspace.module.css';

const IDLE_MS = 2200;

/**
 * The only control shown in the desktop presentation view ("وضع العرض"): a subtle exit
 * button that fades in when the mouse moves and fades out again when it rests.
 * Escape also exits (see useKeyboardShortcuts).
 */
export function ImmersiveExit() {
  // Visible briefly on entry so the way back is discoverable, then only on mouse movement.
  const [visible, setVisible] = useState(true);
  const [hint, setHint] = useState(true);
  const timer = useRef<number | null>(null);
  const hovering = useRef(false);

  useEffect(() => {
    const hideLater = (ms: number) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!hovering.current) setVisible(false);
      }, ms);
    };
    const onMove = () => {
      setVisible(true);
      hideLater(IDLE_MS);
    };
    hideLater(3200);
    const hintTimer = window.setTimeout(() => setHint(false), 3200);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearTimeout(hintTimer);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className={styles.immersiveExit} data-visible={visible} data-testid="immersive-exit-wrap">
      <Button
        icon="exit"
        size="sm"
        variant="quiet"
        onClick={() => useUi.getState().setImmersive(false)}
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => (hovering.current = false)}
        onFocus={() => setVisible(true)}
        aria-keyshortcuts="Escape"
        tabIndex={visible ? 0 : -1}
        data-testid="immersive-exit"
      >
        {t.immersive.exit}
      </Button>
      {hint ? <span className={styles.immersiveHint}>{t.immersive.hint}</span> : null}
    </div>
  );
}
