import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * The only bridge between the page and the desktop shell. Sandboxed, context-isolated;
 * exposes a fixed set of operations (no generic filesystem or IPC access).
 */
type CloseResult = { ok: boolean; nodes: number };
let beforeClose: (() => Promise<CloseResult>) | null = null;

ipcRenderer.on('desktop:before-close', async () => {
  let result: CloseResult | null = null;
  try {
    if (beforeClose) result = await beforeClose();
  } catch {
    result = { ok: false, nodes: -1 };
  }
  ipcRenderer.send('desktop:before-close-done', result ?? { ok: true, nodes: -1 });
});

contextBridge.exposeInMainWorld('orbitalDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  reportStorage: (status: { ok: boolean; code?: string; nodes?: number }) => ipcRenderer.invoke('desktop:storage', status),
  backupDue: () => ipcRenderer.invoke('desktop:backup-due'),
  autoBackup: (text: string) => ipcRenderer.invoke('desktop:backup-auto', text),
  manualBackup: (text: string) => ipcRenderer.invoke('desktop:backup-manual', text),
  safetyBackup: (text: string) => ipcRenderer.invoke('desktop:backup-safety', text),
  checkFile: (file: File) => ipcRenderer.invoke('desktop:check-file', webUtils.getPathForFile(file)),
  onBeforeClose: (handler: () => Promise<CloseResult>) => {
    beforeClose = handler;
  },
});
