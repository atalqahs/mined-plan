import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { remoteDiagnostics } from '@/application/remote/diagnostics';
import { diagnosticContext, downloadText } from './lifecycle';
import { formatPairingCode, normalizePairingCode } from '@/application/remote/pairing';
import { Button } from '@/design-system/components/Button';
import { Icon } from '@/design-system/components/Icon';
import { normalizeArabic } from '@/shared/utils/arabic';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import { BrandMark } from '@/presentation/ui/BrandMark';
import { TouchPad } from './TouchPad';
import { useControllerSession } from './useControllerSession';
import styles from './Controller.module.css';

/** Reads (and immediately removes) a pairing code from the URL fragment: #pair=CODE (from the TV's QR code). */
function takeCodeFromUrl(): string {
  const m = location.hash.match(/pair=([A-Za-z0-9-]+)/);
  if (!m) return '';
  history.replaceState(history.state, '', location.pathname + location.search);
  return m[1];
}

/** Phone companion controller (mobile-first, RTL). */
export default function ControllerApp() {
  const c = useControllerSession();
  const [code, setCode] = useState('');
  const [auto] = useState(takeCodeFromUrl);

  useEffect(() => {
    document.documentElement.dataset.tv = 'control';
    if (auto) {
      setCode(formatPairingCode(normalizePairingCode(auto) ?? auto.toUpperCase()));
      c.connect(auto);
    }
    return () => {
      delete document.documentElement.dataset.tv;
    };
  }, []);

  const k = c.state.kind;
  return (
    <div className={styles.app} data-testid="controller" data-state={k}>
      <header className={styles.head}>
        <BrandMark size={26} />
        <h1>{t.tv.ctlTitle}</h1>
        {k === 'connected' ? (
          <span className={styles.badge} data-testid="ctl-connected">
            <Icon name="check" size={14} /> {t.tv.connected}
          </span>
        ) : null}
      </header>

      {k === 'idle' || k === 'failed' || k === 'ended' ? (
        <ConnectForm
          code={code}
          setCode={setCode}
          onConnect={() => c.connect(code)}
          message={k === 'failed' ? t.tv.failed[c.state.reason] : k === 'ended' ? t.tv.ended[c.state.reason] : null}
        />
      ) : k === 'reconnecting' ? (
        <section className={styles.status} role="status" data-testid="ctl-reconnecting">
          <span className={styles.spinner} aria-hidden="true" />
          <h2>{t.tv.reconnecting}</h2>
          <p>{t.tv.lostCause[c.state.cause] ?? ''}</p>
          <p className={styles.tip}>{t.tv.reconnectingHint(c.state.attempt)}</p>
          <Button variant="quiet" onClick={c.disconnect}>
            {t.tv.disconnect}
          </Button>
          <Diagnostics />
        </section>
      ) : k === 'connecting' || k === 'awaiting-approval' ? (
        <section className={styles.status} role="status" data-testid="ctl-status">
          <span className={styles.spinner} aria-hidden="true" />
          <h2>{k === 'connecting' ? t.tv.connecting : t.tv.awaiting}</h2>
          {k === 'awaiting-approval' ? <p>{t.tv.awaitingHint}</p> : null}
          <p className={styles.codeEcho} dir="ltr">
            {code}
          </p>
          <Button variant="quiet" onClick={c.disconnect}>
            {t.tv.disconnect}
          </Button>
        </section>
      ) : c.share === 'undecided' ? (
        <section className={styles.status} data-testid="ctl-consent">
          <h2>{c.localCount ? t.tv.shareTitle : t.tv.connected}</h2>
          <p>{c.localCount ? t.tv.shareBody(c.localCount) : t.tv.shareEmpty}</p>
          <div className={styles.row}>
            {c.localCount ? (
              <Button variant="primary" icon="tv" onClick={() => c.decideShare('share')} data-testid="ctl-share">
                {t.tv.share}
              </Button>
            ) : null}
            <Button onClick={() => c.decideShare('control-only')} data-testid="ctl-control-only">
              {t.tv.noShare}
            </Button>
          </div>
        </section>
      ) : (
        <Remote c={c} />
      )}
    </div>
  );
}

function ConnectForm({ code, setCode, onConnect, message }: { code: string; setCode(v: string): void; onConnect(): void; message: string | null }) {
  const valid = normalizePairingCode(code) !== null;
  return (
    <form
      className={styles.connect}
      onSubmit={(e) => {
        e.preventDefault();
        onConnect();
      }}
    >
      <p>{t.tv.ctlIntro}</p>
      <label htmlFor="om-pair" className={styles.label}>
        {t.tv.ctlCodeLabel}
      </label>
      <input
        id="om-pair"
        className={styles.codeInput}
        dir="ltr"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        spellCheck={false}
        placeholder="XXXXX-XXXXX"
        maxLength={13}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        data-testid="ctl-code"
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? 'om-pair-err' : undefined}
      />
      {message ? (
        <p id="om-pair-err" className={styles.error} role="alert" data-testid="ctl-error">
          {message}
        </p>
      ) : null}
      {message ? <Diagnostics /> : null}
      <Button variant="primary" type="submit" disabled={!valid} data-testid="ctl-connect">
        {t.tv.ctlConnect}
      </Button>
      <p className={styles.tip}>{t.tv.ctlQrTip}</p>
      <Button variant="quiet" icon="exit" onClick={() => useUi.getState().setTvMode('off')}>
        {t.tv.ctlBack}
      </Button>
    </form>
  );
}

function Remote({ c }: { c: ReturnType<typeof useControllerSession> }) {
  const tv = c.tvState;
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = tv?.selectedId ?? null;
  const selectedTitle = selected ? c.index.find((n) => n.id === selected)?.title : null;

  const items = useMemo(() => {
    const q = normalizeArabic(query);
    if (q) return c.index.filter((n) => normalizeArabic(n.title).includes(q)).slice(0, 80).map((n) => ({ ...n, depth: 0 }));
    // Tree order: each primary followed by its descendants.
    const kids = new Map<string | null, typeof c.index>();
    const ids = new Set(c.index.map((n) => n.id));
    for (const n of c.index) {
      const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
      if (!kids.has(key)) kids.set(key, []);
      kids.get(key)!.push(n);
    }
    const out: Array<(typeof c.index)[number] & { depth: number }> = [];
    const walk = (parent: string | null, depth: number) => {
      for (const n of kids.get(parent) ?? []) {
        if (out.length >= 300) return;
        out.push({ ...n, depth });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [c.index, query]);

  const focusLevel = tv?.focus ? tv.level : 0;
  return (
    <div className={styles.remote} data-testid="ctl-remote">
      <TouchPad send={c.send} />
      {!c.wakeLockSupported ? <p className={styles.tip}>{t.tv.keepAwakeUnavailable}</p> : null}
      {c.share === 'share' ? <ShareStatusLine c={c} /> : null}

      <div className={styles.grid3}>
        <Button icon="zoomIn" onClick={() => c.send({ t: 'zoom', factor: 1.25 })} data-testid="ctl-zoom-in">
          {t.tv.zoomIn}
        </Button>
        <Button icon="zoomOut" onClick={() => c.send({ t: 'zoom', factor: 0.8 })} data-testid="ctl-zoom-out">
          {t.tv.zoomOut}
        </Button>
        <Button icon="home" onClick={() => c.send({ t: 'reset' })} data-testid="ctl-reset">
          {t.tv.reset}
        </Button>
      </div>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h2>{t.tv.pickIdea}</h2>
          <span className={styles.selected} data-testid="ctl-selected">
            {selectedTitle ?? ''}
          </span>
        </div>
        <Button onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen} data-testid="ctl-pick">
          {pickerOpen ? t.tv.close : t.tv.openList}
        </Button>
        {pickerOpen ? (
          <div className={styles.picker}>
            <input className={styles.search} type="search" placeholder={t.tv.pickSearch} aria-label={t.tv.pickSearch} value={query} onChange={(e) => setQuery(e.target.value)} />
            {items.length === 0 ? <p className={styles.tip}>{t.tv.noIdeas}</p> : null}
            <ul className={styles.list} data-testid="ctl-ideas">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={styles.idea}
                    data-depth={Math.min(n.depth, 3)}
                    aria-current={n.id === selected ? 'true' : undefined}
                    onClick={() => {
                      c.send({ t: 'select', id: n.id });
                      setPickerOpen(false);
                    }}
                  >
                    {n.title}
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <Button variant="quiet" onClick={() => c.send({ t: 'select', id: null })}>
                {t.tv.clearSelection}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.block}>
        <h2>{t.toolbar.focus}</h2>
        <div className={styles.segments} role="radiogroup" aria-label={t.toolbar.focus}>
          {([0, 1, 2] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={focusLevel === lvl}
              className={styles.segment}
              disabled={lvl !== 0 && !selected}
              data-testid={`ctl-focus-${lvl}`}
              onClick={() => c.send(lvl === 0 ? { t: 'focus', on: false } : { t: 'focus', on: true, level: lvl })}
            >
              {lvl === 0 ? t.tv.focusOff : lvl === 1 ? t.tv.focusDirect : t.tv.focusExtended}
            </button>
          ))}
        </div>
        {!selected ? <p className={styles.tip}>{t.tv.focusNeeds}</p> : null}
      </section>

      <section className={styles.toggles}>
        <Toggle label={t.overview.toggle} on={!!tv?.primaryOnly} onChange={(on) => c.send({ t: 'primaryOnly', on })} testId="ctl-primary-only" />
        <Toggle label={t.tv.toolbar} on={!!tv?.toolbar} onChange={(visible) => c.send({ t: 'toolbar', visible })} testId="ctl-toolbar" />
        {c.localCount ? (
          <Toggle label={t.tv.sharing} on={c.share === 'share'} onChange={(on) => c.decideShare(on ? 'share' : 'control-only')} testId="ctl-sharing" />
        ) : null}
      </section>

      <div className={styles.block}>
        <Button icon="edit" onClick={() => useUi.getState().setTvMode('off')} data-testid="ctl-edit">
          {t.tv.editIdeas}
        </Button>
        <p className={styles.tip}>{t.tv.editHint}</p>
      </div>
      <div className={styles.row}>
        <Diagnostics />
      </div>
      <div className={styles.row}>
        <Button icon="phone" onClick={c.disconnect} data-testid="ctl-disconnect">
          {t.tv.disconnect}
        </Button>
        <Button variant="danger" icon="exit" onClick={() => c.send({ t: 'exitTv' })} data-testid="ctl-exit-tv">
          {t.tv.exitTv}
        </Button>
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange, testId }: { label: string; on: boolean; onChange(v: boolean): void; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={styles.toggle} onClick={() => onChange(!on)} data-testid={testId}>
      <span>{label}</span>
      <span className={styles.switch} aria-hidden="true" />
    </button>
  );
}

function ShareStatusLine({ c }: { c: ReturnType<typeof useControllerSession> }) {
  const s = c.shareStatus;
  const text =
    s.status === 'sending' ? t.tv.shareSending(s.sent, s.total) : s.status === 'shown' ? t.tv.shareShown(s.nodes, s.edges) : s.status === 'failed' ? t.tv.shareFailed[s.reason] : '';
  return (
    <div className={styles.shareLine} data-testid="ctl-share-status" data-status={s.status} role="status" aria-live="polite">
      <span>{text}</span>
      {s.status === 'failed' && s.reason !== 'connection' ? (
        <Button size="sm" onClick={c.retryShare} data-testid="ctl-share-retry">
          {t.tv.shareRetry}
        </Button>
      ) : null}
    </div>
  );
}

/** Privacy-safe connection log: copy or download for troubleshooting. */
function Diagnostics() {
  const [open, setOpen] = useState(false);
  const count = useSyncExternalStore(
    (l) => remoteDiagnostics.subscribe(l),
    () => remoteDiagnostics.list().length,
  );
  const text = () => remoteDiagnostics.export(diagnosticContext('phone'));
  return (
    <details className={styles.diag} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="ctl-diagnostics">
      <summary>
        {t.tv.diagnostics} ({count})
      </summary>
      <p className={styles.tip}>{t.tv.diagnosticsHint}</p>
      <div className={styles.row}>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text());
              useUi.getState().toast({ message: t.tv.copied, duration: 2000 });
            } catch {
              downloadText('orbital-mind-diagnostics.txt', text());
            }
          }}
        >
          {t.tv.copyLog}
        </Button>
        <Button size="sm" onClick={() => downloadText('orbital-mind-diagnostics.txt', text())} data-testid="ctl-diag-download">
          {t.tv.downloadLog}
        </Button>
      </div>
    </details>
  );
}
