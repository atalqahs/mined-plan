import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, promises as fs, readFileSync, rmSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupStore, dayStamp, isoWeekStamp, sha256 } from '../../desktop/backupStore';
import { validateBackupText } from '../../desktop/validate';
import { resolvePortableRoot } from '../../desktop/paths';
import { JsonBackupCodec } from '@/infrastructure/backup/jsonBackupCodec';
import { arabicGraphBackup } from '../fixtures/arabicGraph';

const graphText = () => JSON.stringify(arabicGraphBackup(69, 18), null, 2);
let root: string;
let clock: Date;
let logs: Array<Record<string, unknown>>;
const store = () => new BackupStore(join(root, 'Backups'), validateBackupText, (e) => logs.push(e), () => clock);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'om-bk-'));
  clock = new Date(2026, 10, 19, 9, 30, 0); // local time
  logs = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('backup naming', () => {
  it('uses the local calendar day and the ISO week', () => {
    expect(dayStamp(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
    expect(isoWeekStamp(new Date(2026, 10, 19))).toBe('2026-W47');
    // ISO week-year edges.
    expect(isoWeekStamp(new Date(2027, 0, 1))).toBe('2026-W53');
    expect(isoWeekStamp(new Date(2025, 11, 29))).toBe('2026-W01');
    expect(isoWeekStamp(new Date(2026, 0, 4))).toBe('2026-W01');
    expect(isoWeekStamp(new Date(2026, 0, 5))).toBe('2026-W02');
  });
});

describe('automatic backups', () => {
  it('creates a verified daily and weekly backup once, importable by the app', async () => {
    const s = store();
    await s.ensureDirs();
    const r = await s.writeAuto(graphText());
    expect(r.daily).toMatchObject({ ok: true, name: '2026-11-19.json', nodes: 69 });
    expect(r.weekly).toMatchObject({ ok: true, name: '2026-W47.json', nodes: 69 });
    const file = join(root, 'Backups/Daily/2026-11-19.json');
    const sidecar = readFileSync(`${file}.sha256`, 'utf8');
    expect(sidecar).toBe(`${sha256(readFileSync(file))}  2026-11-19.json\n`); // sha256sum format
    // Same day again: nothing is due, nothing is rewritten.
    expect(await s.due()).toEqual({ daily: null, weekly: null });
    expect(await s.writeAuto(graphText())).toEqual({ daily: null, weekly: null });
    // The file restores with the original ids, relationships and coordinates.
    const decoded = new JsonBackupCodec().decode(readFileSync(file, 'utf8'));
    const original = new JsonBackupCodec().decode(graphText());
    if (!decoded.ok || !original.ok) throw new Error('decode');
    expect([...decoded.snapshot.nodes.values()]).toEqual([...original.snapshot.nodes.values()]);
    expect([...decoded.snapshot.edges.values()]).toEqual([...original.snapshot.edges.values()]);
    expect(await s.checkFile(file)).toBe('verified');
  });

  it('keeps the newest 7 daily and 4 weekly backups, independently; never touches Manual', async () => {
    const s = store();
    await s.ensureDirs();
    const manual = await s.writeManual(graphText());
    expect(manual.ok).toBe(true);
    for (let day = 0; day < 40; day++) {
      clock = new Date(2026, 9, 1 + day, 10); // 40 consecutive days, one launch per day
      await s.writeAuto(graphText());
    }
    const daily = await s.list('daily');
    const weekly = await s.list('weekly');
    expect(daily).toEqual(['2026-11-09.json', '2026-11-08.json', '2026-11-07.json', '2026-11-06.json', '2026-11-05.json', '2026-11-04.json', '2026-11-03.json']);
    expect(weekly).toEqual(['2026-W46.json', '2026-W45.json', '2026-W44.json', '2026-W43.json']);
    // No orphaned checksum files for deleted backups.
    expect(readdirSync(join(root, 'Backups/Daily')).filter((n) => n.endsWith('.sha256'))).toHaveLength(7);
    expect(readdirSync(join(root, 'Backups/Manual'))).toHaveLength(2); // json + sha256, never pruned
  });

  it('does not create artificial backups for days the app was not opened', async () => {
    const s = store();
    await s.ensureDirs();
    clock = new Date(2026, 10, 1, 10);
    await s.writeAuto(graphText());
    clock = new Date(2026, 10, 19, 10);
    await s.writeAuto(graphText());
    expect(await s.list('daily')).toEqual(['2026-11-19.json', '2026-11-01.json']);
  });

  it('a failed backup never deletes existing backups and leaves no partial file', async () => {
    const s = store();
    await s.ensureDirs();
    for (let day = 0; day < 7; day++) {
      clock = new Date(2026, 10, 1 + day, 10);
      await s.writeAuto(graphText());
    }
    clock = new Date(2026, 10, 19, 10);
    // An invalid snapshot is refused before anything is written.
    const bad = await s.writeAuto('{"app":"orbital-mind","schemaVersion":2,"nodes":[{"id":1}]}');
    expect(bad.daily).toMatchObject({ ok: false });
    expect(await s.list('daily')).toHaveLength(7);
    // A write failure (read-only directory) is reported, and retention does not run.
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      chmodSync(join(root, 'Backups/Daily'), 0o500);
      const r = await s.writeAuto(graphText());
      expect(r.daily).toMatchObject({ ok: false });
      chmodSync(join(root, 'Backups/Daily'), 0o700);
      expect(await s.list('daily')).toHaveLength(7);
    }
    expect(readdirSync(join(root, 'Backups/Daily')).some((n) => n.includes('.tmp-'))).toBe(false);
    expect(logs.some((l) => l.result === 'failed')).toBe(true);
    // Logs never contain idea content.
    expect(JSON.stringify(logs)).not.toMatch(/[\u0600-\u06FF]/);
  });

  it('cleans up temporary files from an interrupted backup', async () => {
    const s = store();
    await s.ensureDirs();
    writeFileSync(join(root, 'Backups/Daily/2026-11-19.json.tmp-123-1'), '{"app":"orbital-');
    expect(await s.cleanupTemp()).toBe(1);
    expect(await s.due()).toEqual({ daily: '2026-11-19.json', weekly: '2026-W47.json' });
  });
});

describe('manual and safety backups', () => {
  it('never overwrites: each manual backup gets a unique name', async () => {
    const s = store();
    await s.ensureDirs();
    const a = await s.writeManual(graphText());
    const b = await s.writeManual(graphText());
    const c = await s.writeSafety(graphText(), 'before-import');
    expect(a).toMatchObject({ ok: true, name: 'ORBITAL-MIND_2026-11-19_09-30-00.json' });
    expect(b).toMatchObject({ ok: true, name: 'ORBITAL-MIND_2026-11-19_09-30-00-2.json' });
    expect(c).toMatchObject({ ok: true, name: 'before-import_2026-11-19_09-30-00.json' });
  });
});

describe('restore checks', () => {
  it('detects corrupted backups (checksum and content) and accepts plain web exports', async () => {
    const s = store();
    await s.ensureDirs();
    const r = await s.writeManual(graphText());
    if (!r.ok) throw new Error(r.error);
    expect(await s.checkFile(r.path)).toBe('verified');
    // Silent corruption that is still valid JSON: one coordinate digit changed.
    const text = readFileSync(r.path, 'utf8');
    const tampered = text.replace(/"position": \[\n\s+(-?\d)/, (m, d) => m.slice(0, -1) + (d === '9' ? '8' : String(Number(d) + 1)));
    expect(tampered).not.toBe(text);
    writeFileSync(r.path, tampered);
    expect(await s.checkFile(r.path)).toBe('corrupt');
    // Truncated file.
    const trunc = join(root, 'trunc.json');
    writeFileSync(trunc, graphText().slice(0, 500));
    expect(await s.checkFile(trunc)).toBe('invalid');
    // A JSON exported from the website (no sidecar) is accepted as unverified.
    const web = join(root, 'orbital-mind-2026-11-18.json');
    writeFileSync(web, graphText());
    expect(await s.checkFile(web)).toBe('unverified');
    expect(await s.checkFile(join(root, 'missing.json'))).toBe('unreadable');
  });
});

describe('portable data root', () => {
  it('uses the original portable executable folder, never the temporary extraction folder', () => {
    expect(resolvePortableRoot({ PORTABLE_EXECUTABLE_DIR: 'E:\\ORBITAL MIND' }, true, 'C:\\Users\\u\\AppData\\Local\\Temp\\2x\\ORBITAL MIND.exe', '/dev').root).toBe('E:\\ORBITAL MIND');
    expect(resolvePortableRoot({}, true, '/opt/ORBITAL MIND/orbital-mind', '/dev')).toEqual({ root: '/opt/ORBITAL MIND', source: 'executable' });
    expect(resolvePortableRoot({}, false, '/x/electron', '/repo/.desktop-data')).toEqual({ root: '/repo/.desktop-data', source: 'development' });
  });
});

it('fixture file sanity', async () => {
  expect((await fs.stat(join(__dirname, '../fixtures/arabicGraph.ts'))).isFile()).toBe(true);
});

describe('disk full', () => {
  // Needs a small dedicated filesystem (e.g. `mount -t tmpfs -o size=200k tmpfs DIR`), so it runs only when TINYFS_DIR is set.
  const tiny = process.env.TINYFS_DIR;
  it.skipIf(!tiny)('an out-of-space backup fails cleanly: no partial file, earlier backups untouched', async () => {
    const dir = join(tiny!, `bk-${Date.now()}`);
    const s = new BackupStore(dir, validateBackupText, (e) => logs.push(e), () => clock);
    await s.ensureDirs();
    clock = new Date(2026, 10, 18, 10);
    const first = await s.writeAuto(graphText());
    expect(first.daily?.ok).toBe(true);
    const before = readFileSync(join(dir, 'Daily/2026-11-18.json'));
    // Fill the disk, leaving less room than one backup needs.
    let i = 0;
    try {
      for (;;) writeFileSync(join(tiny!, `fill-${Date.now()}-${i++}`), Buffer.alloc(4096));
    } catch {
      /* full */
    }
    clock = new Date(2026, 10, 19, 10);
    const r = await s.writeAuto(graphText());
    expect(r.daily).toMatchObject({ ok: false, error: 'ENOSPC' });
    expect(readdirSync(join(dir, 'Daily')).filter((n) => !n.endsWith('.sha256'))).toEqual(['2026-11-18.json']);
    expect(readFileSync(join(dir, 'Daily/2026-11-18.json')).equals(before)).toBe(true);
    for (const n of readdirSync(tiny!)) if (n.startsWith('fill-')) rmSync(join(tiny!, n));
  });
});

describe('schema version record', () => {
  it('DB_SCHEMA_VERSION matches the IndexedDB schema (keeps the pre-upgrade backup and downgrade guard honest)', async () => {
    const { OrbitalDatabase } = await import('@/infrastructure/database/dexieRepository');
    const { DB_SCHEMA_VERSION } = await import('@/infrastructure/database/schemaVersion');
    expect(new OrbitalDatabase('schema-check').verno).toBe(DB_SCHEMA_VERSION);
  });
});
