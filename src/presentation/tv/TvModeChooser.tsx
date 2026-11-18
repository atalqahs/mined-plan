import { memo, useEffect, useRef } from 'react';
import { Button, IconButton } from '@/design-system/components/Button';
import { Icon } from '@/design-system/components/Icon';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import { requestFullscreen } from './fullscreen';
import styles from './TvModeChooser.module.css';

/** Lightweight choice: present on this screen, or control a TV from this device. No extra pages. */
export const TvModeChooser = memo(function TvModeChooser() {
  const open = useUi((s) => s.tv.chooserOpen);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  if (!open) return null;
  const close = () => useUi.getState().setTvChooser(false);
  return (
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <section className={`bevel ${styles.card}`} role="dialog" aria-modal="true" aria-labelledby="om-tv-title" data-testid="tv-chooser">
        <header className={styles.head}>
          <h2 id="om-tv-title">{t.tv.chooserTitle}</h2>
          <IconButton icon="close" size="sm" label={t.tv.close} onClick={close} />
        </header>
        <div className={styles.options}>
          <button
            ref={first}
            type="button"
            className={`bevel ${styles.option}`}
            data-testid="tv-present"
            onClick={() => {
              // Must run inside the click (user gesture) for browsers to allow fullscreen.
              void requestFullscreen();
              useUi.getState().setTvMode('present');
            }}
          >
            <Icon name="tv" size={30} />
            <span className={styles.label}>{t.tv.present}</span>
            <span className={styles.hint}>{t.tv.presentHint}</span>
          </button>
          <button type="button" className={`bevel ${styles.option}`} data-testid="tv-control" onClick={() => useUi.getState().setTvMode('control')}>
            <Icon name="phone" size={30} />
            <span className={styles.label}>{t.tv.control}</span>
            <span className={styles.hint}>{t.tv.controlHint}</span>
          </button>
        </div>
      </section>
    </div>
  );
});

/** While this device controls a TV, a quiet pill leads back to the controller from the full app. */
export const RemoteLinkedPill = memo(function RemoteLinkedPill() {
  const linked = useUi((s) => s.tv.remoteLinked);
  if (!linked) return null;
  return (
    <div className={`bevel bevel-sm ${styles.pill}`} role="status" data-testid="remote-linked-pill">
      <Icon name="tv" size={18} />
      <span>{t.tv.linkedPill}</span>
      <Button size="sm" variant="quiet" onClick={() => useUi.getState().setTvMode('control')} data-testid="back-to-remote">
        {t.tv.backToRemote}
      </Button>
    </div>
  );
});
