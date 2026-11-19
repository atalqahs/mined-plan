import { createHash } from 'node:crypto';
import { constants as fsc, promises as fs } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * Independent, file-based backups for the portable desktop build.
 *
 *   Backups/Daily/2026-11-19.json   (+ .sha256)   automatic, newest 7 kept
 *   Backups/Weekly/2026-W47.json    (+ .sha256)   automatic, newest 4 kept
 *   Backups/Manual/ORBITAL-MIND_2026-11-19_14-30-05.json   never deleted by the app
 *   Backups/Safety/before-import_2026-11-19_14-30-05.json  never deleted by the app
 *
 * Every file is the app's standard JSON backup document (importable with the normal
 * "استيراد JSON" button, on any computer). Integrity: each file is written to a temporary
 * name, fsynced, read back and re-validated, its SHA-256 is written to a `.sha256` sidecar
 * (sha256sum format), and only then is it renamed into place. Retention runs only after a
 * new backup has been verified, and only inside its own category.
 */
export type BackupKind = 'daily' | 'weekly' | 'manual' | 'safety';
export const BACKUP_DIRS: Record<BackupKind, string> = { daily: 'Daily', weekly: 'Weekly', manual: 'Manual', safety: 'Safety' };
export const RETAIN = { daily: 7, weekly: 4 } as const;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

const DAILY_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
const WEEKLY_RE = /^\d{4}-W\d{2}\.json$/;

export type Validation = { ok: true; nodes: number; edges: number; reminders: number } | { ok: false; reason: string };
export type Validator = (text: string) => Validation;
export type WriteResult = { ok: true; name: string; path: string; bytes: number; sha256: string; nodes: number } | { ok: false; error: string };
export type FileCheck = 'verified' | 'unverified' | 'corrupt' | 'invalid' | 'unreadable';
export type LogFn = (entry: Record<string, string | number | boolean>) => void;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local calendar day, e.g. 2026-11-19. */
export function dayStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO-8601 week of the local calendar date, e.g. 2026-W47 (week-year may differ from the calendar year). */
export function isoWeekStamp(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3); // Thursday of this week
  const year = t.getFullYear();
  const jan4 = new Date(year, 0, 4, 12);
  jan4.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3); // Thursday of week 1
  const week = 1 + Math.round((t.getTime() - jan4.getTime()) / (7 * 86_400_000));
  return `${year}-W${pad(week)}`;
}

/** Local timestamp for unique, sortable, human-readable names: 2026-11-19_14-30-05. */
export function timeStamp(d: Date): string {
  return `${dayStamp(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsc.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Write + fsync a new file (fails if it already exists). */
async function writeDurable(path: string, data: Buffer | string): Promise<void> {
  const fh = await fs.open(path, 'wx');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Best effort: persist the directory entry of a rename (not supported on Windows; harmless there). */
async function syncDir(dir: string): Promise<void> {
  try {
    const fh = await fs.open(dir, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    /* unsupported on this platform / filesystem */
  }
}

export class BackupStore {
  constructor(
    readonly root: string,
    private readonly validate: Validator,
    private readonly log: LogFn = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  dir(kind: BackupKind): string {
    return join(this.root, BACKUP_DIRS[kind]);
  }

  async ensureDirs(): Promise<void> {
    for (const k of Object.keys(BACKUP_DIRS) as BackupKind[]) await fs.mkdir(this.dir(k), { recursive: true });
  }

  /** Remove temporary files left by an interrupted backup (never touches finished backups). */
  async cleanupTemp(): Promise<number> {
    let n = 0;
    for (const k of Object.keys(BACKUP_DIRS) as BackupKind[]) {
      let names: string[] = [];
      try {
        names = await fs.readdir(this.dir(k));
      } catch {
        continue;
      }
      for (const name of names)
        if (name.includes('.tmp-')) {
          await fs.rm(join(this.dir(k), name), { force: true });
          n++;
        }
    }
    if (n) this.log({ event: 'cleanup-temp', removed: n });
    return n;
  }

  /** Which automatic backups are still due for the current local day / ISO week. */
  async due(): Promise<{ daily: string | null; weekly: string | null }> {
    const d = this.now();
    const daily = `${dayStamp(d)}.json`;
    const weekly = `${isoWeekStamp(d)}.json`;
    return {
      daily: (await exists(join(this.dir('daily'), daily))) ? null : daily,
      weekly: (await exists(join(this.dir('weekly'), weekly))) ? null : weekly,
    };
  }

  /** Create whichever automatic backups are due from one snapshot, then apply retention. */
  async writeAuto(text: string): Promise<{ daily: WriteResult | null; weekly: WriteResult | null }> {
    const due = await this.due();
    const out: { daily: WriteResult | null; weekly: WriteResult | null } = { daily: null, weekly: null };
    for (const kind of ['daily', 'weekly'] as const) {
      const name = due[kind];
      if (!name) continue;
      const r = await this.writeVerified(kind, name, text);
      out[kind] = r;
      if (r.ok) await this.prune(kind); // only after a verified new backup exists
    }
    return out;
  }

  async writeManual(text: string): Promise<WriteResult> {
    return this.writeUnique('manual', `ORBITAL-MIND_${timeStamp(this.now())}`, text);
  }

  async writeSafety(text: string, reason: 'before-import' | 'before-upgrade'): Promise<WriteResult> {
    return this.writeUnique('safety', `${reason}_${timeStamp(this.now())}`, text);
  }

  /** Check a backup file chosen for restore: checksum (when a sidecar exists) + content validation. */
  async checkFile(path: string): Promise<FileCheck> {
    let buf: Buffer;
    try {
      const st = await fs.stat(path);
      if (!st.isFile() || st.size > MAX_BACKUP_BYTES) return 'unreadable';
      buf = await fs.readFile(path);
    } catch {
      return 'unreadable';
    }
    let expected: string | null = null;
    try {
      expected = (await fs.readFile(`${path}.sha256`, 'utf8')).trim().split(/\s+/)[0]?.toLowerCase() ?? null;
    } catch {
      expected = null;
    }
    if (expected && expected !== sha256(buf)) return 'corrupt';
    if (!this.validate(buf.toString('utf8')).ok) return 'invalid';
    return expected ? 'verified' : 'unverified';
  }

  /** Automatic backups currently on disk, newest first. */
  async list(kind: 'daily' | 'weekly'): Promise<string[]> {
    const re = kind === 'daily' ? DAILY_RE : WEEKLY_RE;
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir(kind));
    } catch {
      return [];
    }
    return names.filter((n) => re.test(n)).sort().reverse();
  }

  // ---------------------------------------------------------------------------

  private async writeUnique(kind: 'manual' | 'safety', stem: string, text: string): Promise<WriteResult> {
    for (let i = 1; i < 1000; i++) {
      const name = i === 1 ? `${stem}.json` : `${stem}-${i}.json`;
      if (await exists(join(this.dir(kind), name))) continue; // never overwrite
      return this.writeVerified(kind, name, text);
    }
    return { ok: false, error: 'no-unique-name' };
  }

  private async writeVerified(kind: BackupKind, name: string, text: string): Promise<WriteResult> {
    const dir = this.dir(kind);
    const final = join(dir, name);
    const tag = `.tmp-${process.pid}-${Date.now()}`;
    const tmp = final + tag;
    const sideTmp = `${final}.sha256${tag}`;
    const fail = async (error: string): Promise<WriteResult> => {
      await fs.rm(tmp, { force: true }).catch(() => {});
      await fs.rm(sideTmp, { force: true }).catch(() => {});
      this.log({ event: 'backup', kind, file: name, result: 'failed', error });
      return { ok: false, error };
    };
    const buf = Buffer.from(text, 'utf8');
    if (buf.byteLength > MAX_BACKUP_BYTES) return fail('too-large');
    const v = this.validate(text);
    if (!v.ok) return fail(`invalid-snapshot:${v.reason}`);
    const hash = sha256(buf);
    try {
      await fs.mkdir(dir, { recursive: true });
      if (await exists(final)) return fail('exists');
      await writeDurable(tmp, buf);
      // Read back what actually reached the disk and verify it before publishing it.
      const back = await fs.readFile(tmp);
      if (sha256(back) !== hash) return fail('readback-mismatch');
      const v2 = this.validate(back.toString('utf8'));
      if (!v2.ok || v2.nodes !== v.nodes || v2.edges !== v.edges || v2.reminders !== v.reminders) return fail('readback-invalid');
      await writeDurable(sideTmp, `${hash}  ${name}\n`);
      await fs.rename(sideTmp, `${final}.sha256`);
      if (await exists(final)) return fail('exists');
      await fs.rename(tmp, final);
      await syncDir(dir);
    } catch (e) {
      return fail((e as NodeJS.ErrnoException).code ?? 'write-error');
    }
    this.log({ event: 'backup', kind, file: name, result: 'ok', bytes: buf.byteLength, nodes: v.nodes, edges: v.edges, reminders: v.reminders });
    return { ok: true, name, path: final, bytes: buf.byteLength, sha256: hash, nodes: v.nodes };
  }

  /** Keep the newest N automatic backups of one category; never touches other categories. */
  private async prune(kind: 'daily' | 'weekly'): Promise<void> {
    const keep = RETAIN[kind];
    const names = await this.list(kind);
    for (const name of names.slice(keep)) {
      try {
        await fs.rm(join(this.dir(kind), name));
        await fs.rm(join(this.dir(kind), `${name}.sha256`), { force: true });
        this.log({ event: 'retention', kind, file: basename(name), result: 'deleted' });
      } catch (e) {
        this.log({ event: 'retention', kind, file: basename(name), result: 'failed', error: (e as NodeJS.ErrnoException).code ?? 'rm-error' });
      }
    }
  }
}
