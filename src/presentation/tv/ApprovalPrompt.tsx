import { useEffect, useRef } from 'react';
import { Button } from '@/design-system/components/Button';
import { Icon } from '@/design-system/components/Icon';
import { t } from '@/presentation/i18n/ar';
import styles from './Tv.module.css';

/** Explicit owner consent before any device may control this screen. D-pad friendly. */
export function ApprovalPrompt({ device, onAllow, onReject }: { device: string; onAllow(): void; onReject(): void }) {
  const reject = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Focus the safe choice first; the owner moves to "allow" deliberately.
    reject.current?.focus();
  }, []);
  const name = t.tv.devices[device] ?? t.tv.devices.other;
  return (
    <div className={styles.scrim}>
      <section className={`bevel ${styles.approval}`} role="alertdialog" aria-modal="true" aria-labelledby="om-approve-title" data-testid="approval-prompt">
        <Icon name="phone" size={34} />
        <h2 id="om-approve-title">{t.tv.requestTitle}</h2>
        <p>{t.tv.requestBody(name)}</p>
        <div className={styles.row}>
          <Button variant="primary" onClick={onAllow} data-testid="approve">
            {t.tv.allow}
          </Button>
          <Button ref={reject} onClick={onReject} data-testid="reject">
            {t.tv.reject}
          </Button>
        </div>
      </section>
    </div>
  );
}
