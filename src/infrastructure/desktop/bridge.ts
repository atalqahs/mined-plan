/**
 * The Windows desktop build's preload bridge (desktop/preload.ts). Absent on the website,
 * where every caller falls back to the existing browser behaviour.
 */
export type DesktopWriteResult = { ok: true; name: string; bytes: number; sha256: string; nodes: number } | { ok: false; error: string };
export type DesktopFileCheck = 'verified' | 'unverified' | 'corrupt' | 'invalid' | 'unreadable';

export interface DesktopBridge {
  info(): Promise<{ version: string; dataDir: string; backupsDir: string; publicUrl: string; rootSource: string; backupSchema: number }>;
  reportStorage(status: { ok: boolean; code?: string; nodes?: number }): Promise<boolean>;
  backupDue(): Promise<{ daily: string | null; weekly: string | null }>;
  autoBackup(text: string): Promise<{ daily: DesktopWriteResult | null; weekly: DesktopWriteResult | null }>;
  manualBackup(text: string): Promise<DesktopWriteResult>;
  safetyBackup(text: string): Promise<DesktopWriteResult>;
  checkFile(file: File): Promise<DesktopFileCheck>;
  onBeforeClose(handler: () => Promise<{ ok: boolean; nodes: number }>): void;
}

export function desktopBridge(): DesktopBridge | null {
  return typeof window !== 'undefined' ? ((window as unknown as { orbitalDesktop?: DesktopBridge }).orbitalDesktop ?? null) : null;
}

/** Public website: the phone opens it to pair with a TV presentation running in the desktop app. */
export const PUBLIC_WEB_URL = 'https://atalqahs.github.io/mined-plan/';
