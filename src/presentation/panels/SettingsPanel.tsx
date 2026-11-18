import { memo, useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/providers/AppContext';
import { Button, IconButton } from '@/design-system/components/Button';
import { Field } from '@/design-system/components/Field';
import { Kbd } from '@/design-system/components/Kbd';
import { t } from '@/presentation/i18n/ar';
import { reconcileSelection } from '@/presentation/hooks/useHistoryActions';
import { useHistoryActions } from '@/presentation/hooks/useHistoryActions';
import { useSafeCommand } from '@/presentation/hooks/useSafeCommand';
import { useUi, type LabelDensity, type MotionPref } from '@/presentation/state/uiStore';
import panel from './Panel.module.css';
import styles from './SettingsPanel.module.css';

export const SettingsPanel = memo(function SettingsPanel() {
  const open = useUi((s) => s.panel === 'settings');
  return open ? <SettingsBody /> : null;
});

function SettingsBody() {
  const { notifier, backup, commands, store, ephemeral } = useApp();
  const prefs = useUi((s) => s.prefs);
  const run = useSafeCommand();
  const { undo } = useHistoryActions();
  const [perm, setPerm] = useState(notifier.permission());
  const [backups, setBackups] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    backup.listBackups().then((b) => setBackups(b.length), () => setBackups(0));
  }, [backup]);

  const exportJson = () => {
    const blob = new Blob([backup.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbital-mind-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    useUi.getState().toast({ message: t.importFlow.exported, tone: 'success', duration: 2500 });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      return useUi.getState().toast({ message: t.importFlow.readError, tone: 'danger' });
    }
    const result = backup.previewImport(text);
    if (fileRef.current) fileRef.current.value = '';
    if (!result.ok) return useUi.getState().toast({ message: t.importFlow.errors[result.error] ?? result.error, tone: 'danger', duration: 7000 });
    const { preview } = result;
    useUi.getState().askConfirm({
      title: t.importFlow.title,
      body: `${t.importFlow.summary(preview.counts.nodes, preview.counts.edges, preview.counts.reminders)} ${t.importFlow.replaceWarning}`,
      detail: preview.issues.length ? `${t.importFlow.issues} ${preview.issues.map(t.importFlow.issue).join('، ')}` : undefined,
      actions: [
        {
          label: t.importFlow.confirm,
          tone: 'primary',
          run: async () => {
            useUi.getState().askConfirm(null);
            useUi.getState().exitFocus();
            await backup.applyImport(preview);
            reconcileSelection(store.getSnapshot().nodes);
            useUi.getState().requestCamera({ kind: 'reset' });
            useUi.getState().toast({ message: t.importFlow.done, tone: 'success', action: { label: t.toasts.undo, run: undo } });
            backup.listBackups().then((b) => setBackups(b.length));
          },
        },
      ],
    });
  };

  return (
    <section className={`bevel ${panel.popover}`} aria-label={t.settings.title} data-testid="settings-panel">
      <div className={panel.head}>
        <div className={panel.headTitle}>
          <h2>{t.settings.title}</h2>
        </div>
        <IconButton icon="close" size="sm" label={t.settings.close} onClick={() => useUi.getState().setPanel('none')} />
      </div>
      <div className={panel.scroll}>
        <section className={panel.section}>
          <h3 className={styles.h}>{t.settings.notifications}</h3>
          <div className={styles.line}>
            <span>{t.settings.permission[perm]}</span>
            {perm === 'default' ? (
              <Button size="sm" variant="primary" icon="bell" onClick={async () => setPerm(await notifier.requestPermission())}>
                {t.reminders.enable}
              </Button>
            ) : null}
          </div>
          <p className={panel.muted}>{t.reminders.limitation}</p>
        </section>

        <section className={panel.section}>
          <h3 className={styles.h}>{t.settings.display}</h3>
          <div role="radiogroup" aria-label={t.settings.labelDensity} className={styles.radioGroup}>
            <span className={styles.label}>{t.settings.labelDensity}</span>
            <div className={styles.segments}>
              {(Object.keys(t.settings.density) as LabelDensity[]).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={prefs.labelDensity === d} className={`bevel bevel-sm ${styles.segment}`} onClick={() => useUi.getState().setPrefs({ labelDensity: d })}>
                  {t.settings.density[d]}
                </button>
              ))}
            </div>
          </div>
          <Field label={t.settings.motion}>
            <select value={prefs.motion} onChange={(e) => useUi.getState().setPrefs({ motion: e.target.value as MotionPref })}>
              {(Object.keys(t.settings.motionOptions) as MotionPref[]).map((m) => (
                <option key={m} value={m}>
                  {t.settings.motionOptions[m]}
                </option>
              ))}
            </select>
          </Field>
          <label className={styles.check}>
            <input type="checkbox" checked={prefs.ambient} onChange={(e) => useUi.getState().setPrefs({ ambient: e.target.checked })} />
            <span>
              {t.settings.ambient}
              <small>{t.settings.ambientHint}</small>
            </span>
          </label>
        </section>

        <section className={panel.section}>
          <h3 className={styles.h}>{t.settings.network}</h3>
          <Button
            icon="orbit"
            onClick={() => {
              if (run(() => (commands.relayout(), true))) useUi.getState().toast({ message: t.toasts.relayoutDone, tone: 'success', action: { label: t.toasts.undo, run: undo } });
            }}
          >
            {t.settings.relayout}
          </Button>
          <p className={panel.muted}>{t.settings.relayoutHint}</p>
        </section>

        <section className={panel.section}>
          <h3 className={styles.h}>{t.settings.data}</h3>
          <p className={panel.muted} data-testid="storage-status">
            {ephemeral || store.repositoryKind === 'memory' ? t.settings.storage.memory : t.settings.storage.indexeddb}
          </p>
          <div className={panel.actions}>
            <Button icon="download" onClick={exportJson} data-testid="export">
              {t.settings.export}
            </Button>
            <Button icon="upload" onClick={() => fileRef.current?.click()} data-testid="import">
              {t.settings.import}
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} data-testid="import-file" />
          </div>
          <p className={panel.muted}>{t.settings.importHint}</p>
          {backups !== null ? <p className={panel.muted}>{t.settings.localBackups(backups)}</p> : null}
        </section>

        <section className={panel.section}>
          <h3 className={styles.h}>{t.settings.shortcuts}</h3>
          <dl className={styles.shortcuts}>
            {t.shortcuts.map(([k, label]) => (
              <div key={k}>
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </section>
  );
}
