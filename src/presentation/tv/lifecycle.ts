import { remoteDiagnostics as diag } from '@/application/remote/diagnostics';

let installed = false;

/** True when running as an installed Home Screen web app (iOS keeps its storage separate from Safari). */
export function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * Records page-lifecycle facts that commonly explain disconnects on phones and TV sticks:
 * visibility changes (screen lock / app switch), pagehide/pageshow (bfcache), freeze/resume,
 * network changes, and main-thread stalls (a long gap between 1-second timer ticks).
 */
export function installLifecycleDiagnostics(): void {
  if (installed) return;
  installed = true;
  diag.log('page.start', { visible: document.visibilityState === 'visible', standalone: isStandalone(), online: navigator.onLine });
  document.addEventListener('visibilitychange', () => diag.log('page.visibility', { state: document.visibilityState }));
  window.addEventListener('pagehide', (e) => diag.log('page.hide', { persisted: (e as PageTransitionEvent).persisted }));
  window.addEventListener('pageshow', (e) => diag.log('page.show', { persisted: (e as PageTransitionEvent).persisted }));
  document.addEventListener('freeze', () => diag.log('page.freeze'));
  document.addEventListener('resume', () => diag.log('page.resume'));
  window.addEventListener('online', () => diag.log('net.online'));
  window.addEventListener('offline', () => diag.log('net.offline'));
  // WebGL context loss (low-memory TV sticks): non-bubbling, so listen in the capture phase.
  document.addEventListener('webglcontextlost', () => diag.log('gl.context-lost'), true);
  document.addEventListener('webglcontextrestored', () => diag.log('gl.context-restored'), true);
  let last = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    // Only meaningful while visible (hidden tabs are throttled by design).
    if (gap > 2500 && document.visibilityState === 'visible') diag.log('page.stall', { ms: gap });
  }, 1000);
}

/** Context line for exported logs (privacy-safe facts only). */
export function diagnosticContext(role: 'tv' | 'phone'): Record<string, unknown> {
  const ua = navigator.userAgent.toLowerCase();
  const platform = ua.includes('iphone') ? 'iphone' : ua.includes('ipad') ? 'ipad' : ua.includes('android') ? 'android' : ua.includes('mac os') ? 'mac' : ua.includes('windows') ? 'windows' : 'other';
  const engine = ua.includes('crios') ? 'chrome-ios' : ua.includes('safari') && !ua.includes('chrome') ? 'safari' : ua.includes('chrome') ? 'chromium' : ua.includes('firefox') ? 'firefox' : 'other';
  return {
    role,
    platform,
    engine,
    standalone: isStandalone(),
    webrtc: typeof RTCPeerConnection !== 'undefined',
    wakeLock: 'wakeLock' in navigator,
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  };
}

export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
