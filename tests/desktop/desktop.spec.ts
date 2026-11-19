import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { JsonBackupCodec } from '../../src/infrastructure/backup/jsonBackupCodec';
import { arabicGraphBackup } from '../fixtures/arabicGraph';

/**
 * End-to-end tests of the PACKAGED desktop app: persistence, portability (moving the
 * folder), the portable launcher's data root, file backups, restore, program updates and
 * failure handling. Each test works on its own copy of the unpacked build folder.
 */
const WIN = process.platform === 'win32';
const APP_DIR = resolve(process.env.DESKTOP_APP_DIR ?? (WIN ? 'release/win-unpacked' : 'release/linux-unpacked'));
const NEXT_DIR = process.env.DESKTOP_APP_DIR_NEXT ? resolve(process.env.DESKTOP_APP_DIR_NEXT) : null;
const EXE = WIN ? 'ORBITAL MIND.exe' : 'orbital-mind';
const BASE = resolve('.desktop-test');
// Software WebGL for headless CI machines without a GPU (override with DESKTOP_TEST_GL).
const GL_ARGS = (process.env.DESKTOP_TEST_GL ?? (WIN ? '' : '--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader')).split(' ').filter(Boolean);
const SYSTEM_PROFILE = WIN ? join(process.env.APPDATA ?? '', 'ORBITAL MIND') : join(homedir(), '.config', 'ORBITAL MIND');
const codec = new JsonBackupCodec();
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

test.describe.configure({ mode: 'serial' });

/** A realistic Arabic graph (69 ideas, 18 cross-links) with deadlines, reminders and colours. */
function fixtureText(): string {
  const doc = arabicGraphBackup(69, 18) as ReturnType<typeof arabicGraphBackup> & { reminders: unknown[] };
  const nodes = doc.nodes as Array<Record<string, unknown>>;
  nodes[9].deadline = '2026-12-31T21:00:00.000Z';
  nodes[20].deadline = '2027-02-14T09:30:00.000Z';
  doc.reminders = [
    { id: 'rem-1', nodeId: 'node-9', dueAt: '2027-12-30T07:00:00.000Z', timezone: 'Asia/Riyadh', completed: false, completedAt: null, notificationState: 'pending', note: 'تذكير بمراجعة العقد' },
    { id: 'rem-2', nodeId: 'node-20', dueAt: '2027-01-05T07:00:00.000Z', timezone: 'Asia/Riyadh', repeatRule: 'weekly', completed: false, completedAt: null, notificationState: 'pending' },
    { id: 'rem-3', nodeId: 'node-33', dueAt: '2027-03-01T07:00:00.000Z', timezone: 'Europe/Istanbul', completed: true, completedAt: '2026-10-01T08:00:00.000Z', notificationState: 'notified' },
  ];
  return JSON.stringify(doc, null, 2);
}

function install(name: string, from = APP_DIR): string {
  const dir = join(BASE, name, 'ORBITAL MIND');
  rmSync(join(BASE, name), { recursive: true, force: true });
  mkdirSync(join(BASE, name), { recursive: true });
  cpSync(from, dir, { recursive: true, verbatimSymlinks: true });
  return dir;
}

async function launch(dir: string, env: Record<string, string> = {}, extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page; stderr: () => string }> {
  const app = await _electron.launch({ executablePath: join(dir, EXE), args: [...GL_ARGS, ...extraArgs], env: { ...(process.env as Record<string, string>), ORBITAL_MIND_TEST: '1', ...env }, timeout: 60_000 });
  let err = '';
  app.process().stderr?.on('data', (d) => (err += String(d)));
  const page = await app.firstWindow();
  await page.locator('canvas').waitFor({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => !!window.__orbital), { timeout: 30_000 }).toBe(true);
  return { app, page, stderr: () => err };
}

/** Graceful close: the app writes pending changes before the window goes away. */
async function close(app: ElectronApplication) {
  await app.close();
}

const nodeCount = (p: Page) => p.evaluate(() => window.__orbital!.nodeCount());
const fingerprint = (p: Page) =>
  p.evaluate(() => {
    const o = window.__orbital!;
    return o
      .ids()
      .sort()
      .map((id) => `${id}:${JSON.stringify(o.positionOf(id))}`)
      .join('|');
  });

async function importFile(page: Page, file: string) {
  await page.getByTestId('settings').click();
  await page.getByTestId('import-file').setInputFiles(file);
}

async function addIdea(page: Page, title: string) {
  await page.keyboard.press('Escape');
  await page.getByTestId('add-idea').click();
  await page.getByTestId('add-title').fill(title);
  await page.getByTestId('add-submit').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.keyboard.press('Escape');
}

function decodeFile(path: string) {
  const r = codec.decode(readFileSync(path, 'utf8'));
  if (!r.ok) throw new Error(`backup did not decode: ${r.error}`);
  return r.snapshot;
}
const sidecarOk = (path: string) => readFileSync(`${path}.sha256`, 'utf8').split(/\s+/)[0] === createHash('sha256').update(readFileSync(path)).digest('hex');
const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);

const systemProfileExisted = existsSync(SYSTEM_PROFILE);
let A = '';
let fpA = '';

test.beforeAll(() => {
  expect(existsSync(join(APP_DIR, EXE)), `packaged app not found at ${APP_DIR} — run npm run dist:${WIN ? 'win' : 'linux'}-dir`).toBe(true);
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  writeFileSync(join(BASE, 'web-export.json'), fixtureText());
});

test('first launch: portable layout next to the executable, trusted origin, locked-down renderer, offline assets', async () => {
  A = install('A');
  const { app, page } = await launch(A);
  for (const d of ['Data/Profile', 'Backups/Daily', 'Backups/Weekly', 'Backups/Manual', 'Backups/Safety']) expect(existsSync(join(A, d)), d).toBe(true);
  expect(page.url()).toBe('app://orbital-mind/index.html');
  const info = await page.evaluate(() => (window as unknown as { orbitalDesktop: { info(): Promise<{ dataDir: string; rootSource: string }> } }).orbitalDesktop.info());
  expect(info).toMatchObject({ dataDir: join(A, 'Data'), rootSource: 'executable' });
  // Nothing is stored in the system profile (AppData / ~/.config).
  if (!systemProfileExisted) expect(existsSync(SYSTEM_PROFILE)).toBe(false);

  // Renderer security: no Node, no navigation away, no pop-ups, no network except signaling.
  expect(await page.evaluate(() => [typeof (window as unknown as { require?: unknown }).require, typeof (window as unknown as { process?: unknown }).process])).toEqual(['undefined', 'undefined']);
  expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true);
  expect(await page.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'blocked'))).toBe('blocked');
  // Bundled Arabic fonts and the 3D scene work without any network.
  expect(await page.evaluate(async () => (await document.fonts.ready, document.fonts.check('16px "IBM Plex Sans Arabic"')))).toBe(true);
  await expect(page.getByRole('heading', { name: 'مِدار' })).toBeVisible();
  expect((await page.evaluate(() => window.__orbital!.rendered())).nodes).toBe(0);
  // Navigation away from the bundled app is refused (checked last: the cancelled navigation confuses page waits).
  await page.evaluate(() => setTimeout(() => (location.href = 'https://example.com/'), 0));
  await new Promise((r) => setTimeout(r, 1500));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL())).toBe('app://orbital-mind/index.html');
  await close(app);
  expect(readFileSync(join(A, 'Data/logs/desktop.log'), 'utf8')).toContain('"event":"close","flushed":true');
});

test('migration + persistence: import a realistic Arabic graph, edit, exit, relaunch — everything is preserved', async () => {
  let { app, page } = await launch(A);
  await importFile(page, join(BASE, 'web-export.json'));
  await page.getByRole('button', { name: 'استبدل الشبكة' }).click();
  await expect.poll(() => nodeCount(page)).toBe(69);
  // A display preference (not part of the website's JSON format) and a new idea.
  await page.getByRole('radio', { name: 'كثيفة' }).click();
  await addIdea(page, 'فكرة جديدة من سطح المكتب');
  expect(await nodeCount(page)).toBe(70);
  fpA = await fingerprint(page);
  await close(app);

  ({ app, page } = await launch(A));
  expect(await nodeCount(page)).toBe(70);
  expect(await fingerprint(page)).toBe(fpA);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('orbital-mind:ui') ?? '{}').state?.prefs?.labelDensity)).toBe('high');

  // Manual backup (the existing "export" button) → a verified file in Backups/Manual.
  await page.getByTestId('settings').click();
  await page.getByTestId('export').click();
  await expect(page.getByText(/حُفظت نسخة احتياطية في المجلد/)).toBeVisible();
  const manual = files(join(A, 'Backups/Manual')).filter((n) => n.endsWith('.json'));
  expect(manual).toHaveLength(1);
  const manualPath = join(A, 'Backups/Manual', manual[0]);
  expect(sidecarOk(manualPath)).toBe(true);
  await close(app);

  // Every field of every record survived: ids, hierarchy, links, positions, notes, colours, status, deadlines, reminders.
  const original = codec.decode(fixtureText());
  if (!original.ok) throw new Error('fixture');
  const saved = decodeFile(manualPath);
  for (const [id, n] of original.snapshot.nodes) {
    const s = saved.nodes.get(id)!;
    expect(s, id).toBeTruthy();
    expect({ ...s, updatedAt: '', createdAt: '' }).toEqual({ ...n, updatedAt: '', createdAt: '' });
  }
  const byId = <T extends { id: string }>(m: ReadonlyMap<string, T>) => [...m.values()].sort((x, y) => x.id.localeCompare(y.id));
  expect(byId(saved.edges)).toEqual(byId(original.snapshot.edges));
  expect(saved.edges.size).toBe(18);
  expect([...saved.reminders.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...original.snapshot.reminders.values()].sort((a, b) => a.id.localeCompare(b.id)));
  expect([...saved.nodes.values()].some((n) => n.title === 'فكرة جديدة من سطح المكتب')).toBe(true);
  expect(JSON.parse(readFileSync(manualPath, 'utf8')).preferences).toMatchObject({ labelDensity: 'high' });
});

test('automatic daily + weekly backups are verified files of the latest saved data', async () => {
  const daily = join(A, 'Backups/Daily', `${today}.json`);
  const weekly = files(join(A, 'Backups/Weekly')).filter((n) => /^\d{4}-W\d{2}\.json$/.test(n));
  expect(existsSync(daily)).toBe(true); // first launch had no ideas → skipped; the relaunch created it
  expect(weekly).toHaveLength(1);
  expect(sidecarOk(daily)).toBe(true);
  expect(sidecarOk(join(A, 'Backups/Weekly', weekly[0]))).toBe(true);
  expect(decodeFile(daily).nodes.size).toBe(70);
  const log = readFileSync(join(A, 'Data/logs/backup.log'), 'utf8');
  expect(log).toContain('"kind":"daily"');
  expect(log).not.toMatch(/[؀-ۿ]/); // logs never contain idea content
});

test('moving the folder: copy to another location, same data; edits there persist; the original copy is independent', async () => {
  const B = join(BASE, 'B', 'ORBITAL MIND');
  rmSync(join(BASE, 'B'), { recursive: true, force: true });
  mkdirSync(join(BASE, 'B'));
  cpSync(A, B, { recursive: true, verbatimSymlinks: true });
  let { app, page } = await launch(B);
  expect(await page.evaluate(() => (window as unknown as { orbitalDesktop: { info(): Promise<{ dataDir: string }> } }).orbitalDesktop.info().then((i) => i.dataDir))).toBe(join(B, 'Data'));
  expect(await nodeCount(page)).toBe(70);
  expect(await fingerprint(page)).toBe(fpA);
  await addIdea(page, 'تعديل على الحاسوب الثاني');
  await close(app);
  ({ app, page } = await launch(B));
  expect(await nodeCount(page)).toBe(71);
  await close(app);
  ({ app, page } = await launch(A));
  expect(await nodeCount(page)).toBe(70); // copies are not synchronised
  await close(app);
});

test('portable launcher: data lives next to the original .exe (PORTABLE_EXECUTABLE_DIR), never in the extracted folder', async () => {
  const C = join(BASE, 'C', 'ORBITAL MIND');
  rmSync(join(BASE, 'C'), { recursive: true, force: true });
  mkdirSync(C, { recursive: true });
  const before = files(join(A, 'Data'));
  const { app, page } = await launch(A, { PORTABLE_EXECUTABLE_DIR: C }); // A plays the temporary extraction folder
  expect(await page.evaluate(() => (window as unknown as { orbitalDesktop: { info(): Promise<{ dataDir: string; rootSource: string }> } }).orbitalDesktop.info())).toMatchObject({ dataDir: join(C, 'Data'), rootSource: 'portable-launcher' });
  expect(await nodeCount(page)).toBe(0);
  await close(app);
  expect(existsSync(join(C, 'Data/Profile/IndexedDB'))).toBe(true);
  expect(existsSync(join(C, 'Backups/Daily'))).toBe(true);
  expect(files(join(A, 'Data'))).toEqual(before);
});

test('restore: a daily backup restores ids, relations and positions; a safety backup is made first; corrupted backups are rejected', async () => {
  const daily = join(A, 'Backups/Daily', `${today}.json`);
  const { app, page } = await launch(A);
  await addIdea(page, 'تغيير بعد النسخة الاحتياطية');
  expect(await nodeCount(page)).toBe(71);

  // Corrupted (valid JSON, one coordinate changed, checksum no longer matches): rejected, nothing changes.
  const tampered = join(A, 'Backups/Manual', 'tampered.json');
  const text = readFileSync(daily, 'utf8');
  const bad = text.replace(/"position": \[\n\s+(-?\d)/, (m, d) => m.slice(0, -1) + (d === '9' ? '8' : String(Number(d) + 1)));
  expect(bad).not.toBe(text);
  writeFileSync(tampered, bad);
  cpSync(`${daily}.sha256`, `${tampered}.sha256`);
  await importFile(page, tampered);
  await expect(page.getByText(/هذه النسخة الاحتياطية تالفة/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'استبدل الشبكة' })).toHaveCount(0);
  // Truncated file: the existing validation refuses it.
  const trunc = join(BASE, 'truncated.json');
  writeFileSync(trunc, text.slice(0, 900));
  await page.getByTestId('import-file').setInputFiles(trunc);
  await expect(page.getByText('الملف ليس JSON صالحًا.')).toBeVisible();
  expect(await nodeCount(page)).toBe(71);

  // Restore the daily backup.
  await page.getByTestId('import-file').setInputFiles(daily);
  await page.getByRole('button', { name: 'استبدل الشبكة' }).click();
  await expect.poll(() => nodeCount(page)).toBe(70);
  expect(await fingerprint(page)).toBe(fpA);
  const safety = files(join(A, 'Backups/Safety')).filter((n) => n.startsWith('before-import_') && n.endsWith('.json'));
  expect(safety).toHaveLength(1);
  expect(decodeFile(join(A, 'Backups/Safety', safety[0])).nodes.size).toBe(71); // the replaced data is kept
  await close(app);
  const again = await launch(A);
  expect(await fingerprint(again.page)).toBe(fpA);
  await close(again.app);
});

test('program update: replacing the program files keeps Data and Backups intact', async () => {
  test.skip(!NEXT_DIR, 'set DESKTOP_APP_DIR_NEXT to a newer build (e.g. version 1.0.1)');
  const U = join(BASE, 'U', 'ORBITAL MIND');
  rmSync(join(BASE, 'U'), { recursive: true, force: true });
  mkdirSync(join(BASE, 'U'));
  cpSync(A, U, { recursive: true, verbatimSymlinks: true });
  const backupsBefore = ['Daily', 'Weekly', 'Manual', 'Safety'].map((d) => files(join(U, 'Backups', d)));
  // The documented update procedure: replace everything except Data and Backups.
  for (const name of readdirSync(U)) if (name !== 'Data' && name !== 'Backups') rmSync(join(U, name), { recursive: true, force: true });
  cpSync(NEXT_DIR!, U, { recursive: true, verbatimSymlinks: true });
  const { app, page } = await launch(U);
  expect(await nodeCount(page)).toBe(70);
  expect(await fingerprint(page)).toBe(fpA);
  await close(app);
  const state = JSON.parse(readFileSync(join(U, 'Data/state.json'), 'utf8'));
  expect(state.appVersion).not.toBe('1.0.0');
  expect(['Daily', 'Weekly', 'Manual', 'Safety'].map((d) => files(join(U, 'Backups', d)))).toEqual(backupsBefore);
});

test('failure handling: newer data refused, older schema snapshotted first, unusable folders reported, empty database warned', async () => {
  const run = (dir: string) => spawnSync(join(dir, EXE), GL_ARGS, { env: { ...process.env, ORBITAL_MIND_TEST: '1' }, encoding: 'utf8', timeout: 90_000 });
  const hashDir = (dir: string) => {
    const h = createHash('sha256');
    const walk = (d: string) => {
      for (const n of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = join(d, n.name);
        if (n.isDirectory()) walk(p);
        else if (n.name !== 'LOCK') h.update(n.name).update(readFileSync(p));
      }
    };
    walk(dir);
    return h.digest('hex');
  };

  // 1. Data written by a newer program: refuse to open, change nothing.
  const N = join(BASE, 'N', 'ORBITAL MIND');
  rmSync(join(BASE, 'N'), { recursive: true, force: true });
  mkdirSync(join(BASE, 'N'));
  cpSync(A, N, { recursive: true, verbatimSymlinks: true });
  const st = JSON.parse(readFileSync(join(N, 'Data/state.json'), 'utf8'));
  writeFileSync(join(N, 'Data/state.json'), JSON.stringify({ ...st, dbSchema: 99 }));
  const idb = hashDir(join(N, 'Data/Profile/IndexedDB'));
  const r1 = run(N);
  expect(r1.status).toBe(3);
  expect(r1.stderr).toContain('ORBITAL_FATAL newer-data');
  expect(hashDir(join(N, 'Data/Profile/IndexedDB'))).toBe(idb);

  // 2. Data from an older schema: a verified copy of the database is made before opening.
  writeFileSync(join(N, 'Data/state.json'), JSON.stringify({ ...st, dbSchema: 1 }));
  let { app, page } = await launch(N);
  expect(await nodeCount(page)).toBe(70);
  await close(app);
  const snap = files(join(N, 'Backups/Safety')).filter((n) => n.startsWith('database-before-v'));
  expect(snap).toHaveLength(1);
  expect(existsSync(join(N, 'Backups/Safety', snap[0], 'IndexedDB'))).toBe(true);
  expect(JSON.parse(readFileSync(join(N, 'Data/state.json'), 'utf8')).dbSchema).toBe(2);

  // 3. Data folder unusable (a file is in the way): clear error, the app does not start on temporary storage.
  const F = install('F');
  writeFileSync(join(F, 'Data'), 'not a folder');
  const r3 = run(F);
  expect(r3.status).toBe(3);
  expect(r3.stderr).toContain('ORBITAL_FATAL data-unwritable');
  // 4. Backups folder unusable.
  rmSync(join(F, 'Data'));
  writeFileSync(join(F, 'Backups'), 'not a folder');
  const r4 = run(F);
  expect(r4.status).toBe(3);
  expect(r4.stderr).toContain('ORBITAL_FATAL backups-unwritable');

  // 5. Read-only Data folder.
  const R = install('R');
  mkdirSync(join(R, 'Data'));
  let restore = () => {};
  if (WIN) {
    spawnSync('icacls', [join(R, 'Data'), '/deny', '*S-1-1-0:(OI)(CI)(W,AD)'], { encoding: 'utf8' });
    restore = () => void spawnSync('icacls', [join(R, 'Data'), '/remove:d', '*S-1-1-0'], { encoding: 'utf8' });
  } else if (process.getuid?.() !== 0) {
    spawnSync('chmod', ['0555', join(R, 'Data')]);
    restore = () => void spawnSync('chmod', ['0755', join(R, 'Data')]);
  } else test.info().annotations.push({ type: 'unverified', description: 'read-only folder: running as root, permissions are not enforced' });
  // Only meaningful if the OS really refuses writes there (e.g. not when running as root/elevated owner).
  let enforced = false;
  try {
    writeFileSync(join(R, 'Data', 'probe.txt'), 'x');
    rmSync(join(R, 'Data', 'probe.txt'));
  } catch {
    enforced = true;
  }
  if (!enforced) test.info().annotations.push({ type: 'unverified', description: 'read-only folder: the OS did not enforce the restriction for this user' });
  if (enforced) {
    const r5 = run(R);
    restore();
    expect(r5.status).toBe(3);
    expect(r5.stderr).toContain('ORBITAL_FATAL data-unwritable');
  }

  // 6. The database comes back empty although the folder had ideas: warned, and no backup of the empty graph.
  rmSync(join(N, 'Data/Profile/IndexedDB'), { recursive: true, force: true });
  rmSync(join(N, 'Backups/Daily', `${today}.json`), { force: true });
  let stderr: () => string;
  ({ app, page, stderr } = await launch(N));
  expect(await nodeCount(page)).toBe(0);
  await expect.poll(stderr).toContain('ORBITAL_WARNING empty-after-data 70');
  await page.waitForTimeout(2500);
  expect(existsSync(join(N, 'Backups/Daily', `${today}.json`))).toBe(false); // older backups are never rotated out by an empty graph
  await close(app);
});

test('display: high-DPI, resize, fullscreen, presentation view, minimise/restore', async () => {
  const { app, page } = await launch(A, {}, ['--force-device-scale-factor=2']);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
  expect((await page.evaluate(() => window.__orbital!.rendered())).nodes).toBe(70);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 700));
  await expect.poll(async () => Math.round((await page.locator('canvas').boundingBox())!.width)).toBe(1100);
  // F11 as a native key event (goes through the same path as a real keyboard).
  const f11 = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' }));
  await f11();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
  // (Xvfb has no window manager, so the window only grows on a real desktop.)
  if (WIN) await expect.poll(async () => Math.round((await page.locator('canvas').boundingBox())!.width)).toBeGreaterThan(1100);
  await f11();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
  await page.getByTestId('immersive-toggle').click();
  await expect(page.locator('header')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('header')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForTimeout(500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  expect(await fingerprint(page)).toBe(fpA);
  await close(app);
});
