import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, promises as fs, readFileSync, rmSync, writeSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Safety checks for the portable Data folder, run before the browser session starts.
 * Nothing here ever deletes or modifies user data.
 */

export interface DataState {
  format: 1;
  /** IndexedDB schema version last opened successfully with this Data folder. */
  dbSchema: number;
  /** Backup JSON schema version written by that program. */
  backupSchema: number;
  appVersion: string;
  createdAt: string;
  lastOpenedAt: string;
  /** Number of ideas when the app was last closed (detects a database that comes back empty). */
  lastNodeCount?: number;
}

/** Prove the folder accepts durable writes (catches read-only media, permissions, full disks). */
export async function probeWritable(dir: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const probe = join(dir, `.write-test-${process.pid}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const fh = await fs.open(probe, 'w');
    try {
      await fh.writeFile('orbital-mind write test');
      await fh.sync();
    } finally {
      await fh.close();
    }
    if ((await fs.readFile(probe, 'utf8')) !== 'orbital-mind write test') return { ok: false, code: 'readback' };
    await fs.rm(probe, { force: true });
    return { ok: true };
  } catch (e) {
    await fs.rm(probe, { force: true }).catch(() => {});
    return { ok: false, code: (e as NodeJS.ErrnoException).code ?? 'unknown' };
  }
}

/** Synchronous variant, for the checks that must run before Chromium touches the profile. */
export function probeWritableSync(dir: string): { ok: true } | { ok: false; code: string } {
  const probe = join(dir, `.write-test-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    const fd = openSync(probe, 'w');
    try {
      writeSync(fd, 'orbital-mind write test');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (readFileSync(probe, 'utf8') !== 'orbital-mind write test') return { ok: false, code: 'readback' };
    rmSync(probe, { force: true });
    return { ok: true };
  } catch (e) {
    try {
      rmSync(probe, { force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, code: (e as NodeJS.ErrnoException).code ?? 'unknown' };
  }
}

export async function readState(dataDir: string): Promise<DataState | null | 'corrupt'> {
  let text: string;
  try {
    text = await fs.readFile(join(dataDir, 'state.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    const s = JSON.parse(text) as DataState;
    if (s?.format !== 1 || !Number.isInteger(s.dbSchema)) return 'corrupt';
    return s;
  } catch {
    return 'corrupt';
  }
}

export async function writeState(dataDir: string, state: DataState): Promise<void> {
  const final = join(dataDir, 'state.json');
  const tmp = `${final}.tmp-${process.pid}`;
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(JSON.stringify(state, null, 2));
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, final);
}

export type SchemaDecision = 'fresh' | 'same' | 'upgrade' | 'newer' | 'unknown';

/** What the stored data means for this program version. */
export function decideSchema(state: DataState | null | 'corrupt', hasDatabase: boolean, current: number): SchemaDecision {
  if (!hasDatabase) return 'fresh';
  if (state === null || state === 'corrupt') return 'unknown';
  if (state.dbSchema > current) return 'newer';
  if (state.dbSchema < current) return 'upgrade';
  return 'same';
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const hashFile = async (p: string) => createHash('sha256').update(await fs.readFile(p)).digest('hex');

/**
 * Verified file-level copy of the browser storage (IndexedDB + Local Storage), taken while
 * the database is closed — before a schema upgrade or when the Data folder's history is
 * unknown. Every copied file is re-hashed against its source.
 */
export async function snapshotProfile(profileDir: string, destDir: string): Promise<{ ok: true; files: number } | { ok: false; code: string }> {
  let files = 0;
  try {
    for (const sub of ['IndexedDB', 'Local Storage']) {
      const src = join(profileDir, sub);
      try {
        await fs.access(src);
      } catch {
        continue;
      }
      for await (const file of walk(src)) {
        if (/[/\\]LOCK$/.test(file)) continue; // lock files are not data
        const target = join(destDir, sub, relative(src, file));
        await fs.mkdir(join(target, '..'), { recursive: true });
        await fs.copyFile(file, target);
        if ((await hashFile(file)) !== (await hashFile(target))) return { ok: false, code: 'verify-mismatch' };
        files++;
      }
    }
    return { ok: true, files };
  } catch (e) {
    return { ok: false, code: (e as NodeJS.ErrnoException).code ?? 'copy-error' };
  }
}

export async function hasDatabase(profileDir: string): Promise<boolean> {
  try {
    const names = await fs.readdir(join(profileDir, 'IndexedDB'));
    return names.some((n) => n.startsWith('app_orbital-mind'));
  } catch {
    return false;
  }
}
