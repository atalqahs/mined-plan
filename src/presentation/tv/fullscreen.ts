/** Fullscreen helpers. Some TV browsers (WebViews) don't implement the API; callers fall back to the full viewport. */
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function fullscreenSupported(): boolean {
  const el = document.documentElement as FsEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export async function requestFullscreen(): Promise<boolean> {
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false; // denied or unsupported — the app still uses the full viewport
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (d.fullscreenElement) await d.exitFullscreen();
    else if (d.webkitFullscreenElement) await d.webkitExitFullscreen?.();
  } catch {
    /* ignore */
  }
}
