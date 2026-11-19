import type { AppContainer } from '@/app/bootstrap/container';
import { desktopBridge } from '@/infrastructure/desktop/bridge';
import { t } from '@/presentation/i18n/ar';
import { useUi, type LabelDensity, type MotionPref } from '@/presentation/state/uiStore';

/**
 * Windows desktop build only (no-op on the website): storage status, safe close,
 * and the independent file backups in the portable Backups folder.
 */

type Prefs = { labelDensity: LabelDensity; motion: MotionPref; ambient: boolean };
const DENSITY: LabelDensity[] = ['low', 'balanced', 'high'];
const MOTION: MotionPref[] = ['system', 'reduced', 'full'];
const AUTO_BACKUP_CHECK_MS = 60 * 60 * 1000;

/**
 * A desktop backup is the app's standard JSON backup document plus a `preferences`
 * block (display settings). Older importers and the website simply ignore the extra block.
 */
export async function desktopBackupText(app: AppContainer): Promise<string> {
  const doc = JSON.parse(await app.backup.exportPersistedJson()) as Record<string, unknown>;
  doc.preferences = { ...useUi.getState().prefs };
  return JSON.stringify(doc, null, 2);
}

/** Display preferences stored in a desktop backup, if present and valid. */
export function readBackupPreferences(text: string): Prefs | null {
  try {
    const p = (JSON.parse(text) as { preferences?: Partial<Prefs> }).preferences;
    if (!p || !DENSITY.includes(p.labelDensity!) || !MOTION.includes(p.motion!) || typeof p.ambient !== 'boolean') return null;
    return { labelDensity: p.labelDensity!, motion: p.motion!, ambient: p.ambient };
  } catch {
    return null;
  }
}

export async function installDesktopIntegration(app: AppContainer): Promise<void> {
  const desktop = desktopBridge();
  if (!desktop || app.ephemeral) return;
  // Never continue on a temporary store: the shell shows a clear error and closes instead.
  const failed = app.storageFailure !== null || app.store.repositoryKind === 'memory';
  await desktop.reportStorage(failed ? { ok: false, code: String(app.storageFailure ?? 'memory-store').slice(0, 120) } : { ok: true, nodes: app.store.getSnapshot().nodes.size });
  if (failed) return;

  desktop.onBeforeClose(async () => {
    await app.store.flush();
    return { ok: !app.store.hasUnsavedChanges(), nodes: app.store.getSnapshot().nodes.size };
  });

  const autoBackup = async () => {
    try {
      const due = await desktop.backupDue();
      if (!due.daily && !due.weekly) return;
      // Nothing to protect yet — and an empty graph must never rotate older, real backups out.
      if (app.store.getSnapshot().nodes.size === 0) return;
      const r = await desktop.autoBackup(await desktopBackupText(app));
      if ((r.daily && !r.daily.ok) || (r.weekly && !r.weekly.ok)) throw new Error('backup-failed');
    } catch {
      useUi.getState().toast({ message: t.desktop.autoBackupFailed, tone: 'warning', duration: 12_000 });
    }
  };
  window.setTimeout(() => void autoBackup(), 1500);
  window.setInterval(() => void autoBackup(), AUTO_BACKUP_CHECK_MS); // a session left open past midnight
}

/** "تصدير JSON" in the desktop build: a verified file in Backups/Manual. */
export async function saveManualBackup(app: AppContainer): Promise<void> {
  const desktop = desktopBridge()!;
  try {
    const r = await desktop.manualBackup(await desktopBackupText(app));
    if (!r.ok) throw new Error(r.error);
    useUi.getState().toast({ message: t.desktop.manualSaved(r.name), tone: 'success', duration: 6000 });
  } catch {
    useUi.getState().toast({ message: t.desktop.manualFailed, tone: 'danger', duration: 10_000 });
  }
}

/** Before a destructive import: the selected file must not be corrupted. */
export async function checkImportFile(file: File): Promise<boolean> {
  const desktop = desktopBridge();
  if (!desktop) return true;
  const status = await desktop.checkFile(file).catch(() => 'unreadable' as const);
  if (status === 'corrupt') {
    useUi.getState().toast({ message: t.desktop.corrupt, tone: 'danger', duration: 10_000 });
    return false;
  }
  return true; // 'invalid' / 'unreadable' are reported in detail by the normal import validation
}

/** Before a destructive import: a verified file copy of the current data in Backups/Safety. */
export async function safetyBackupBeforeImport(app: AppContainer): Promise<boolean> {
  const desktop = desktopBridge();
  if (!desktop || app.store.getSnapshot().nodes.size === 0) return true;
  try {
    const r = await desktop.safetyBackup(await desktopBackupText(app));
    if (r.ok) return true;
  } catch {
    /* reported below */
  }
  useUi.getState().toast({ message: t.desktop.safetyFailed, tone: 'danger', duration: 12_000 });
  return false;
}
