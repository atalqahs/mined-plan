import { memo, useEffect, useRef } from 'react';
import { Button } from '@/design-system/components/Button';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import styles from './Overlays.module.css';

/** The only modal in the app — reserved for destructive / replacing actions. */
export const ConfirmDialog = memo(function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirm) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button[data-cancel]')?.focus();
    return () => prev?.focus?.();
  }, [confirm]);
  if (!confirm) return null;
  const close = () => useUi.getState().askConfirm(null);
  return (
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={ref}
        className={`bevel ${styles.dialog}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="om-confirm-title"
        aria-describedby="om-confirm-body"
        data-testid="confirm-dialog"
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
          e.preventDefault();
          items[next]?.focus();
        }}
      >
        <h2 id="om-confirm-title">{confirm.title}</h2>
        <p id="om-confirm-body">{confirm.body}</p>
        {confirm.detail ? <p className={styles.detail}>{confirm.detail}</p> : null}
        <div className={styles.dialogActions}>
          {confirm.actions.map((a) => (
            <Button key={a.label} variant={a.tone === 'danger' ? 'danger' : a.tone === 'primary' ? 'primary' : 'default'} onClick={a.run}>
              {a.label}
            </Button>
          ))}
          <Button variant="quiet" onClick={close} data-cancel="">
            {t.del.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
});
