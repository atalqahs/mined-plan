import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { formatPairingCode } from '@/application/remote/pairing';
import type { TvSessionState } from '@/application/remote/tvSession';
import { Button } from '@/design-system/components/Button';
import { t } from '@/presentation/i18n/ar';
import styles from './Tv.module.css';

/** The phone opens this link (native camera QR scan). The code travels in the #fragment — never sent to any server. */
export function pairingLink(code: string): string {
  const url = new URL(location.href);
  url.search = '?tv=control';
  url.hash = `pair=${code}`;
  return url.toString();
}

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [text]);
  // Locally generated SVG (no external input besides our own URL).
  return <div className={styles.qr} role="img" aria-label={t.tv.scanQr} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function useCountdown(expiresAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return '';
  const s = Math.max(0, Math.round((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function PairingCard({ state, onDismiss, onRetry }: { state: TvSessionState; onDismiss(): void; onRetry(): void }) {
  const waiting = state.kind === 'waiting' ? state : null;
  const remaining = useCountdown(waiting?.expiresAt ?? null);
  return (
    <aside className={`bevel ${styles.pairing}`} aria-label={t.tv.pairTitle} data-testid="pairing-card">
      <h2>{t.tv.pairTitle}</h2>
      {state.kind === 'error' ? (
        <>
          <p className={styles.muted} role="alert">
            {state.reason === 'unsupported' ? t.tv.unsupported : t.tv.signalingError}
          </p>
          <div className={styles.row}>
            <Button onClick={onRetry}>{t.tv.retry}</Button>
            <Button variant="quiet" onClick={onDismiss} data-testid="pairing-dismiss">
              {t.tv.continueWithout}
            </Button>
          </div>
        </>
      ) : waiting ? (
        <div className={styles.pairGrid}>
          <QrCode text={pairingLink(waiting.code)} />
          <div className={styles.pairText}>
            <p className={styles.step}>
              <strong>{t.tv.scanQr}</strong> {t.tv.scanHint}
            </p>
            <p className={styles.step}>{t.tv.orCode}</p>
            <div className={styles.code} aria-label={t.tv.pairingCode} data-testid="pairing-code" dir="ltr">
              {formatPairingCode(waiting.code)}
            </div>
            <p className={styles.muted}>{t.tv.expiresIn(remaining)}</p>
            <Button variant="quiet" size="sm" onClick={onDismiss} data-testid="pairing-dismiss">
              {t.tv.continueWithout}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.muted}>{t.tv.preparing}</p>
          <Button variant="quiet" size="sm" onClick={onDismiss} data-testid="pairing-dismiss">
            {t.tv.continueWithout}
          </Button>
        </>
      )}
    </aside>
  );
}
