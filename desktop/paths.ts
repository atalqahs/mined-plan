import { dirname } from 'node:path';

/**
 * The portable data root: the folder that contains "ORBITAL MIND.exe".
 *
 * electron-builder's portable target is a self-extracting launcher: it unpacks the real
 * app into a temporary folder and runs it from there. `process.execPath` then points at
 * the temporary copy, so it must NOT be used. The launcher sets PORTABLE_EXECUTABLE_DIR
 * to the folder of the original .exe — that is the root. For an unpacked build (folder
 * with the .exe and its DLLs) the executable's own folder is the root.
 */
export function resolvePortableRoot(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
  execPath: string,
  devRoot: string,
): { root: string; source: 'portable-launcher' | 'executable' | 'development' } {
  const portable = env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portable) return { root: portable, source: 'portable-launcher' };
  if (isPackaged) return { root: dirname(execPath), source: 'executable' };
  return { root: devRoot, source: 'development' };
}
