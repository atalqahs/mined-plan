import { useEffect, useRef } from 'react';
import { useApp } from '@/app/providers/AppContext';
import { t } from '@/presentation/i18n/ar';
import { useKeyboardShortcuts } from '@/presentation/hooks/useKeyboardShortcuts';
import { useReminderBridge } from '@/presentation/hooks/useReminderBridge';
import { reconcileSelection } from '@/presentation/hooks/useHistoryActions';
import { useReducedMotion, useUi } from '@/presentation/state/uiStore';
import { SceneContainer } from '@/presentation/scene3d/SceneContainer';
import { sceneRuntime } from '@/presentation/scene3d/runtime';
import { DetailsPanel } from '@/presentation/panels/details/DetailsPanel';
import { NotificationCenter } from '@/presentation/panels/NotificationCenter';
import { SettingsPanel } from '@/presentation/panels/SettingsPanel';
import { AddIdeaPopover } from '@/presentation/panels/AddIdeaPopover';
import { PrimaryIdeasPanel } from '@/presentation/panels/PrimaryIdeasPanel';
import { Toolbar } from './Toolbar';
import { Toasts } from './Toasts';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState, FocusBanner, LinkBanner, OverviewBanner } from './Banners';
import styles from './Workspace.module.css';
import './labels.css';

/** The single workspace: scene, chrome and contextual panels — no page navigation. */
export function Workspace() {
  const app = useApp();
  const searchRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  useKeyboardShortcuts(searchRef);
  useReminderBridge();

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [reduced]);

  // Startup reports: storage problems and repaired / quarantined data are never silent.
  useEffect(() => {
    const ui = useUi.getState();
    if (app.storageFailure) ui.toast({ message: t.toasts.storageFailure, tone: 'danger', duration: 0 });
    if (app.init.quarantined) ui.toast({ message: t.toasts.quarantined(app.init.quarantined), tone: 'warning', duration: 0 });
    const repaired = app.init.integrity.orphanedNodes.length + app.init.integrity.brokenCycles.length;
    if (repaired) ui.toast({ message: t.toasts.repaired(repaired), tone: 'warning', duration: 12000 });
  }, [app]);

  // Keep UI selection valid after any data change (undo, import, delete).
  useEffect(() => app.store.subscribe(() => reconcileSelection(app.store.getSnapshot().nodes)), [app.store]);

  // Warn before closing with unsaved writes.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (app.store.hasUnsavedChanges()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [app.store]);

  return (
    <div className={styles.app}>
      <Toolbar searchRef={searchRef} />
      <main className={styles.stage} aria-label={t.scene.canvasLabel}>
        <SceneContainer />
        <div
          className={styles.labels}
          aria-hidden="true"
          ref={(el) => {
            sceneRuntime.labelHost = el;
          }}
        />
        <div className={styles.vignette} aria-hidden="true" />
        <EmptyState />
        <FocusBanner />
        <LinkBanner />
        <OverviewBanner />
      </main>
      <DetailsPanel />
      <NotificationCenter />
      <SettingsPanel />
      <PrimaryIdeasPanel />
      <AddIdeaPopover />
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}
