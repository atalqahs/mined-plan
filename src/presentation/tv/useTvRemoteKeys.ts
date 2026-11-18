import { useEffect } from 'react';
import { sceneRuntime } from '@/presentation/scene3d/runtime';
import { useUi } from '@/presentation/state/uiStore';

/**
 * Android TV remote / keyboard equivalents while presenting:
 *   toolbar hidden:  OK/Enter/Menu → show toolbar · D-pad → orbit · +/− or channel keys → zoom
 *                    Back → show toolbar (never exits by accident)
 *   toolbar shown:   D-pad left/right → move between toolbar buttons · Back/Escape → hide toolbar
 * The browser "back" gesture is intercepted the same way via a history entry.
 */
const ORBIT_STEP = 0.2;
const BACK_KEYS = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack']);

export function useTvRemoteKeys() {
  useEffect(() => {
    const ui = () => useUi.getState();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const visible = ui().tv.toolbarVisible;
      if (BACK_KEYS.has(e.key)) {
        e.preventDefault();
        ui().setTvToolbar(!visible);
        return;
      }
      if (visible) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-tv-toolbar] button:not([disabled])')];
          if (!buttons.length) return;
          e.preventDefault();
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          // RTL: ArrowLeft moves toward the inline end (next).
          const step = e.key === 'ArrowLeft' ? 1 : -1;
          buttons[(i + step + buttons.length) % buttons.length]?.focus();
        }
        return;
      }
      const cam = sceneRuntime.camera;
      switch (e.key) {
        case 'Enter':
        case ' ':
        case 'ContextMenu':
        case 'Menu':
          e.preventDefault();
          ui().setTvToolbar(true);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          return cam?.rotate(ORBIT_STEP, 0);
        case 'ArrowRight':
          e.preventDefault();
          return cam?.rotate(-ORBIT_STEP, 0);
        case 'ArrowUp':
          e.preventDefault();
          return cam?.rotate(0, ORBIT_STEP * 0.6);
        case 'ArrowDown':
          e.preventDefault();
          return cam?.rotate(0, -ORBIT_STEP * 0.6);
        case '+':
        case '=':
        case 'PageUp':
        case 'ChannelUp':
        case 'MediaFastForward':
          e.preventDefault();
          return cam?.zoom(1.15);
        case '-':
        case 'PageDown':
        case 'ChannelDown':
        case 'MediaRewind':
          e.preventDefault();
          return cam?.zoom(1 / 1.15);
      }
    };
    window.addEventListener('keydown', onKey);

    // Hardware/browser Back: reveal the toolbar first; only a second Back (with the toolbar shown) leaves TV mode.
    history.pushState({ omTv: true }, '');
    const onPop = () => {
      if (!ui().tv.toolbarVisible) {
        ui().setTvToolbar(true);
        history.pushState({ omTv: true }, '');
      } else {
        ui().setTvMode('off');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
  }, []);
}
