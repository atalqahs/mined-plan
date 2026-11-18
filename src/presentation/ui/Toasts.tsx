import { memo, useEffect } from 'react';
import { IconButton } from '@/design-system/components/Button';
import { Icon } from '@/design-system/components/Icon';
import { t } from '@/presentation/i18n/ar';
import { useUi, type Toast } from '@/presentation/state/uiStore';
import styles from './Overlays.module.css';

export const Toasts = memo(function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className={styles.toasts} role="region" aria-live="polite" aria-label="الإشعارات العابرة">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
});

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    if (!toast.duration) return;
    const id = window.setTimeout(() => useUi.getState().dismissToast(toast.id), toast.duration);
    return () => window.clearTimeout(id);
  }, [toast.id, toast.duration]);
  return (
    <div className={`bevel bevel-sm ${styles.toast}`} data-tone={toast.tone} role={toast.tone === 'danger' ? 'alert' : 'status'}>
      {toast.tone === 'warning' || toast.tone === 'danger' ? <Icon name={toast.tone === 'danger' ? 'alert' : 'bell'} size={18} /> : null}
      <span className={styles.toastMsg}>{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className={styles.toastAction}
          onClick={() => {
            toast.action!.run();
            useUi.getState().dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton icon="close" size="sm" label={t.toasts.dismiss} onClick={() => useUi.getState().dismissToast(toast.id)} />
    </div>
  );
}
