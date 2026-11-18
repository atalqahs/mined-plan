import { useCallback } from 'react';
import { useApp } from '@/app/providers/AppContext';
import { getDescendantIds } from '@/domain/graph/hierarchy';
import { t } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';
import { useHistoryActions } from './useHistoryActions';
import { useSafeCommand } from './useSafeCommand';

/** Confirmation before destruction, then an immediate "undo" affordance. */
export function useDeleteFlow() {
  const { store, commands } = useApp();
  const { undo } = useHistoryActions();
  const run = useSafeCommand();
  return useCallback(
    (id: string) => {
      const s = store.getSnapshot();
      const node = s.nodes.get(id);
      if (!node) return;
      const descendants = getDescendantIds(s.nodes, id).length;
      const ui = useUi.getState();
      const doDelete = (mode: 'cascade' | 'promoteChildren') => {
        ui.askConfirm(null);
        if (!run(() => (commands.deleteNode(id, mode), true))) return;
        if (useUi.getState().focus.active) useUi.getState().exitFocus();
        useUi.getState().select(null);
        useUi.getState().toast({ message: t.toasts.deleted, tone: 'info', duration: 8000, action: { label: t.toasts.undo, run: undo } });
      };
      ui.askConfirm({
        title: t.del.title(node.title),
        body: t.del.body,
        detail: descendants ? t.del.hasChildren(descendants) : undefined,
        actions: descendants
          ? [
              { label: t.del.promote, tone: 'default', run: () => doDelete('promoteChildren') },
              { label: t.del.cascade, tone: 'danger', run: () => doDelete('cascade') },
            ]
          : [{ label: t.del.confirm, tone: 'danger', run: () => doDelete('cascade') }],
      });
    },
    [store, commands, undo, run],
  );
}
