import { remoteDiagnostics as diag } from '@/application/remote/diagnostics';

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(t: 'release', l: () => void): void };

/**
 * Keeps the screen on while active (Screen Wake Lock API). On iPhone this prevents
 * Auto-Lock from suspending Safari — and with it the WebRTC link — after 30–60 s
 * without touches. Supported in Safari 16.4+ (Home Screen apps: iOS 18.4+) and
 * Chromium; elsewhere it is a no-op and the UI shows a tip instead.
 * The lock is released by the browser when the page is hidden, so it is re-acquired
 * on every return to the foreground.
 */
export function createWakeLock() {
  let sentinel: Sentinel | null = null;
  let wanted = false;
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const acquire = async () => {
    if (!supported || !wanted || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
    try {
      sentinel = (await (navigator as Navigator & { wakeLock: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock.request('screen')) as Sentinel;
      diag.log('wake.acquired');
      sentinel.addEventListener('release', () => diag.log('wake.released'));
    } catch {
      diag.log('wake.denied');
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void acquire();
  };
  document.addEventListener('visibilitychange', onVisible);

  return {
    supported,
    set(on: boolean) {
      wanted = on;
      if (on) void acquire();
      else if (sentinel && !sentinel.released) void sentinel.release();
    },
    dispose() {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel && !sentinel.released) void sentinel.release();
    },
  };
}
