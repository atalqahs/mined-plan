import { memo, useMemo, type RefObject } from 'react';
import { useApp, useSaveStatus, useSnapshot } from '@/app/providers/AppContext';
import { Button, IconButton } from '@/design-system/components/Button';
import { attentionCount, groupReminders } from '@/application/queries/reminders';
import { localTimezone } from '@/domain/reminders/zonedTime';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import { useHistoryActions } from '@/presentation/hooks/useHistoryActions';
import { useNow } from '@/presentation/hooks/useNow';
import { BrandMark } from './BrandMark';
import { SearchBox } from './SearchBox';
import styles from './Toolbar.module.css';

export const Toolbar = memo(function Toolbar({ searchRef }: { searchRef: RefObject<HTMLInputElement | null> }) {
  const focus = useUi((s) => s.focus);
  const panel = useUi((s) => s.panel);
  const hasSelection = useUi((s) => s.selectedId !== null);
  const { undo, redo } = useHistoryActions();
  const { store } = useApp();
  const snapshot = useSnapshot();
  const now = useNow(30_000);
  const attention = useMemo(() => attentionCount(groupReminders(snapshot, now, localTimezone())), [snapshot, now]);

  const toggleFocus = () => {
    const ui = useUi.getState();
    if (ui.focus.active) ui.exitFocus();
    else if (!ui.enterFocus()) ui.toast({ message: t.focus.needSelection, duration: 2500 });
  };

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <BrandMark className={styles.mark} />
        <h1>{t.appName}</h1>
        <span className={styles.tagline}>{t.appTagline}</span>
      </div>

      <div className={styles.center}>
        <SearchBox inputRef={searchRef} />
      </div>

      <div className={styles.actions}>
        <SaveIndicator />
        <Button
          icon="layers"
          onClick={() => useUi.getState().togglePanel('primaries')}
          aria-pressed={panel === 'primaries'}
          aria-haspopup="true"
          data-testid="primaries-toggle"
          style={panel === 'primaries' ? ({ '--bevel-edge': 'var(--c-accent)', color: 'var(--accent-text)' } as React.CSSProperties) : undefined}
        >
          {t.primaries.button}
        </Button>
        <Button variant="primary" icon="plus" onClick={() => useUi.getState().openAdd(useUi.getState().selectedId)} aria-keyshortcuts="N" data-testid="add-idea">
          {t.toolbar.addIdea}
        </Button>
        <div className={styles.focusGroup}>
          <Button icon="focus" onClick={toggleFocus} aria-pressed={focus.active} className={focus.active ? 'is-active' : undefined} disabled={!hasSelection && !focus.active} title={hasSelection ? `${t.toolbar.focus} (F)` : t.focus.needSelection} aria-keyshortcuts="F" data-testid="focus-toggle" style={focus.active ? ({ '--bevel-edge': 'var(--c-accent)', color: 'var(--accent-text)' } as React.CSSProperties) : undefined}>
            {t.toolbar.focus}
          </Button>
          {focus.active ? (
            <div role="group" aria-label={t.focus.levelLabel} className={styles.focusGroup}>
              {([1, 2] as const).map((lvl) => (
                <button key={lvl} type="button" className={`bevel bevel-sm ${styles.segment}`} aria-pressed={focus.level === lvl} onClick={() => useUi.getState().setFocusLevel(lvl)} title="Shift+F">
                  {lvl === 1 ? t.focus.direct : t.focus.extended}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <span className={styles.divider} />
        <IconButton icon="undo" label={t.toolbar.undo} shortcut="Ctrl+Z" onClick={undo} disabled={!store.canUndo()} />
        <IconButton icon="redo" label={t.toolbar.redo} shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!store.canRedo()} />
        <IconButton icon="home" label={t.toolbar.resetView} onClick={() => useUi.getState().requestCamera({ kind: 'reset' })} />
        <span className={styles.divider} />
        <IconButton
          icon="bell"
          label={attention ? `${t.toolbar.notifications} (${attention})` : t.toolbar.notifications}
          active={panel === 'notifications'}
          onClick={() => useUi.getState().togglePanel('notifications')}
          data-testid="bell"
          badge={attention ? <span className={styles.badge} aria-hidden="true">{attention > 99 ? '99+' : attention}</span> : null}
        />
        <IconButton icon="settings" label={t.toolbar.settings} active={panel === 'settings'} onClick={() => useUi.getState().togglePanel('settings')} data-testid="settings" />
      </div>
    </header>
  );
});

function SaveIndicator() {
  const status = useSaveStatus();
  const label = status === 'saving' ? t.toolbar.saving : status === 'error' ? t.toolbar.saveError : t.toolbar.saved;
  const dot = status === 'saving' ? styles.dotSaving : status === 'error' ? styles.dotError : '';
  return (
    <span className={styles.status} role="status" aria-live="polite" data-testid="save-status" data-state={status}>
      <span className={`${styles.dot} ${dot}`} aria-hidden="true" />
      {status === 'idle' ? '' : label}
    </span>
  );
}
