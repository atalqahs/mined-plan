import { useEffect } from 'react';
import { useApp } from '@/app/providers/AppContext';
import { useUi } from '@/presentation/state/uiStore';
import { t } from '@/presentation/i18n/ar';
import { useHistoryActions } from './useHistoryActions';
import { useDeleteFlow } from './useDeleteFlow';
import { childrenOf } from '@/application/queries/relations';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/**
 * Global shortcuts. Uses KeyboardEvent.code (physical keys) so they work with
 * an Arabic keyboard layout, where e.key for "F" would be "ب".
 */
export function useKeyboardShortcuts(searchRef: React.RefObject<HTMLInputElement | null>) {
  const { store } = useApp();
  const { undo, redo } = useHistoryActions();
  const requestDelete = useDeleteFlow();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.code === 'KeyK') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.code === 'Escape') {
        if (ui.confirm) return ui.askConfirm(null);
        if (ui.linkFromId) return ui.cancelLink();
        if (ui.addOpen) return ui.closeAdd();
        if (ui.panel !== 'none') return ui.setPanel('none');
        if (isTyping(e.target)) return (e.target as HTMLElement).blur();
        if (ui.focus.active) return ui.exitFocus();
        if (ui.detailsOpen) return ui.closeDetails();
        if (ui.selectedId) return ui.select(null);
        return;
      }
      if (isTyping(e.target) || ui.confirm) return;

      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        return redo();
      }
      if (mod || e.altKey) return;

      switch (e.code) {
        case 'KeyF': {
          e.preventDefault();
          if (e.shiftKey) {
            ui.setFocusLevel(ui.focus.level === 1 ? 2 : 1);
            if (!ui.focus.active) ui.enterFocus();
            return;
          }
          if (ui.focus.active) ui.exitFocus();
          else if (!ui.enterFocus()) ui.toast({ message: t.focus.needSelection, duration: 2500 });
          return;
        }
        case 'KeyP':
          e.preventDefault();
          ui.setPrimaryOnly(!ui.primaryOnly);
          return;
        case 'KeyN':
          e.preventDefault();
          ui.openAdd(e.shiftKey ? ui.selectedId : null);
          return;
        case 'KeyL':
          if (ui.selectedId) {
            e.preventDefault();
            ui.startLink(ui.selectedId);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (ui.selectedId) {
            e.preventDefault();
            requestDelete(ui.selectedId);
          }
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const s = store.getSnapshot();
          const sel = ui.selectedId ? s.nodes.get(ui.selectedId) : undefined;
          e.preventDefault();
          if (!sel) {
            const first = [...s.nodes.values()].find((n) => !n.parentId);
            if (first) ui.select(first.id, { fly: true });
            return;
          }
          if (e.code === 'ArrowUp') {
            if (sel.parentId) ui.select(sel.parentId, { fly: true });
            return;
          }
          if (e.code === 'ArrowDown') {
            const kid = childrenOf(s, sel.id)[0];
            if (kid) ui.select(kid.id, { fly: true });
            return;
          }
          // Cycle through siblings (or primary ideas). RTL: ArrowLeft = next.
          const siblings = [...s.nodes.values()].filter((n) => n.parentId === sel.parentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          const i = siblings.findIndex((n) => n.id === sel.id);
          const step = e.code === 'ArrowLeft' ? 1 : -1;
          const next = siblings[(i + step + siblings.length) % siblings.length];
          if (next && next.id !== sel.id) ui.select(next.id, { fly: true });
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, undo, redo, requestDelete, searchRef]);
}
