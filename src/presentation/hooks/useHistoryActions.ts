import { useCallback } from 'react';
import { useApp } from '@/app/providers/AppContext';
import { commandLabel, t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import type { CommandLabel } from '@/application/commands/mindCommands';

export function useHistoryActions() {
  const { store } = useApp();
  const undo = useCallback(() => {
    const label = store.undo() as CommandLabel | null;
    reconcileSelection(store.getSnapshot().nodes);
    useUi.getState().toast({ message: label ? t.toasts.undone(commandLabel[label]) : t.toasts.nothingToUndo, duration: 2500 });
  }, [store]);
  const redo = useCallback(() => {
    const label = store.redo() as CommandLabel | null;
    reconcileSelection(store.getSnapshot().nodes);
    useUi.getState().toast({ message: label ? t.toasts.redone(commandLabel[label]) : t.toasts.nothingToRedo, duration: 2500 });
  }, [store]);
  return { undo, redo };
}

/** Clear selection/link state that points at nodes which no longer exist. */
export function reconcileSelection(nodes: ReadonlyMap<string, unknown>) {
  const ui = useUi.getState();
  if (ui.selectedId && !nodes.has(ui.selectedId)) ui.select(null);
  if (ui.linkFromId && !nodes.has(ui.linkFromId)) ui.cancelLink();
  if (ui.hoveredId && !nodes.has(ui.hoveredId)) ui.hover(null);
}
