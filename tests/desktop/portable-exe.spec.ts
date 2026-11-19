import { _electron, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arabicGraphBackup } from '../fixtures/arabicGraph';

/**
 * Tests of the REAL single-file portable executable (electron-builder `portable` target),
 * which unpacks itself into %TEMP% on every start. Windows only (CI job on windows-latest).
 *   PORTABLE_EXE       built "ORBITAL MIND.exe" (version 1.0.0)
 *   PORTABLE_EXE_NEXT  a newer build (e.g. 1.0.1) for the update test
 *   DESKTOP_APP_DIR    the matching unpacked build, used only to type data in through the UI
 *
 * The portable .exe is driven through its content-free self-test report
 * (ORBITAL_MIND_SELFTEST_OUT): where it stored data, how many ideas it loaded, a hash of
 * their ids + positions, and the backup files present.
 */
const EXE = process.env.PORTABLE_EXE ? resolve(process.env.PORTABLE_EXE) : null;
const EXE_NEXT = process.env.PORTABLE_EXE_NEXT ? resolve(process.env.PORTABLE_EXE_NEXT) : null;
const APP_DIR = resolve(process.env.DESKTOP_APP_DIR ?? 'release/win-unpacked');
const BASE = resolve('.desktop-test-portable');
const GL_ARGS = (process.env.DESKTOP_TEST_GL ?? '').split(' ').filter(Boolean);

test.describe.configure({ mode: 'serial' });
test.skip(!EXE || process.platform !== 'win32', 'Windows portable executable tests (set PORTABLE_EXE)');

interface Report {
  root: string;
  rootSource: string;
  execPath: string;
  portableDir: string | null;
  dataDir: string;
  profileDir: string;
  origin: string;
  graph: { nodes: number; fingerprint: string };
  backups: { daily: string[]; weekly: string[]; manual: string[]; safety: string[] };
}

/** Run the real portable .exe from `dir` and collect its report. */
async function runPortable(dir: string, exeName = 'ORBITAL MIND.exe'): Promise<Report> {
  const out = join(BASE, `report-${Date.now()}.json`);
  const child = spawn(join(dir, exeName), GL_ARGS, { env: { ...process.env, ORBITAL_MIND_TEST: '1', ORBITAL_MIND_SELFTEST_OUT: out }, stdio: 'ignore', windowsHide: false });
  const deadline = Date.now() + 150_000;
  while (!existsSync(out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  expect(existsSync(out), 'portable app produced its report').toBe(true);
  // Wait for the whole app (launcher + app) to exit, so the folder can be copied safely.
  await new Promise<void>((r) => {
    if (child.exitCode !== null) return r();
    const t = setTimeout(() => (child.kill(), r()), 60_000);
    child.on('exit', () => (clearTimeout(t), r()));
  });
  await new Promise((r) => setTimeout(r, 3000));
  return JSON.parse(readFileSync(out, 'utf8')) as Report;
}

/** Type data in through the real UI (unpacked build), storing it in `root` exactly as the portable launcher would. */
async function withUi(root: string, fn: (page: import('@playwright/test').Page) => Promise<void>) {
  const app = await _electron.launch({ executablePath: join(APP_DIR, 'ORBITAL MIND.exe'), args: GL_ARGS, env: { ...(process.env as Record<string, string>), ORBITAL_MIND_TEST: '1', PORTABLE_EXECUTABLE_DIR: root } });
  const page = await app.firstWindow();
  await expect.poll(() => page.evaluate(() => !!window.__orbital), { timeout: 60_000 }).toBe(true);
  await fn(page);
  await app.close();
}

let fingerprint = '';

test.beforeAll(() => {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
});

test('the real portable .exe keeps its data next to itself, not in the temporary extraction folder', async () => {
  const A = join(BASE, 'A', 'ORBITAL MIND');
  mkdirSync(A, { recursive: true });
  copyFileSync(EXE!, join(A, 'ORBITAL MIND.exe'));
  // Populate A's Data through the UI: import a realistic Arabic graph.
  writeFileSync(join(BASE, 'graph.json'), JSON.stringify(arabicGraphBackup(69, 18)));
  await withUi(A, async (page) => {
    await page.getByTestId('settings').click();
    await page.getByTestId('import-file').setInputFiles(join(BASE, 'graph.json'));
    await page.getByRole('button', { name: 'استبدل الشبكة' }).click();
    await expect.poll(() => page.evaluate(() => window.__orbital!.nodeCount())).toBe(69);
  });

  const r = await runPortable(A);
  expect(r.rootSource).toBe('portable-launcher');
  expect(r.root.toLowerCase()).toBe(A.toLowerCase());
  expect(r.dataDir.toLowerCase()).toBe(join(A, 'Data').toLowerCase());
  expect(r.profileDir.toLowerCase()).toBe(join(A, 'Data', 'Profile').toLowerCase());
  // The process really ran from the extracted copy elsewhere…
  expect(r.execPath.toLowerCase().startsWith(A.toLowerCase())).toBe(false);
  // …and still found the data stored next to the original .exe.
  expect(r.origin).toBe('app://orbital-mind/index.html');
  expect(r.graph.nodes).toBe(69);
  expect(r.backups.daily.some((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))).toBe(true);
  expect(r.backups.weekly.some((n) => /^\d{4}-W\d{2}\.json$/.test(n))).toBe(true);
  expect(readdirSync(A).sort()).toEqual(['Backups', 'Data', 'ORBITAL MIND.exe']);
  fingerprint = r.graph.fingerprint;
});

test('copy the whole folder elsewhere (another computer / USB): same data, edits persist, copies stay independent', async () => {
  const A = join(BASE, 'A', 'ORBITAL MIND');
  const B = join(BASE, 'USB', 'copy', 'ORBITAL MIND');
  mkdirSync(join(B, '..'), { recursive: true });
  cpSync(A, B, { recursive: true });
  expect(readdirSync(B).sort()).toEqual(['Backups', 'Data', 'ORBITAL MIND.exe']);
  let r = await runPortable(B);
  expect(r.root.toLowerCase()).toBe(B.toLowerCase());
  expect(r.graph.nodes).toBe(69);
  expect(r.graph.fingerprint).toBe(fingerprint);
  await withUi(B, async (page) => {
    await page.getByTestId('add-idea').click();
    await page.getByTestId('add-title').fill('فكرة على الحاسوب الثاني');
    await page.getByTestId('add-submit').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  });
  r = await runPortable(B);
  expect(r.graph.nodes).toBe(70);
  r = await runPortable(B); // relaunch again
  expect(r.graph.nodes).toBe(70);
  expect((await runPortable(A)).graph.nodes).toBe(69);
});

test('a folder whose path contains Arabic characters works the same way', async () => {
  const A = join(BASE, 'A', 'ORBITAL MIND');
  const C = join(BASE, 'مجلد عربي', 'ORBITAL MIND');
  mkdirSync(join(C, '..'), { recursive: true });
  cpSync(A, C, { recursive: true });
  expect(readdirSync(C).sort(), 'copy into the Arabic-named folder').toEqual(['Backups', 'Data', 'ORBITAL MIND.exe']);
  const r = await runPortable(C);
  expect(r.root.toLowerCase()).toBe(C.toLowerCase());
  expect(r.graph.nodes).toBe(69);
  expect(r.graph.fingerprint).toBe(fingerprint);
});

test('update: replacing the portable .exe with a newer one keeps Data and Backups', async () => {
  test.skip(!EXE_NEXT, 'set PORTABLE_EXE_NEXT');
  const A = join(BASE, 'A', 'ORBITAL MIND');
  const backups = ['Daily', 'Weekly', 'Manual', 'Safety'].map((d) => readdirSync(join(A, 'Backups', d)).sort());
  copyFileSync(EXE_NEXT!, join(A, 'ORBITAL MIND.exe'));
  const r = await runPortable(A);
  expect(r.graph.nodes).toBe(69);
  expect(r.graph.fingerprint).toBe(fingerprint);
  expect(JSON.parse(readFileSync(join(A, 'Data', 'state.json'), 'utf8')).appVersion).toBe('1.0.1');
  const after = ['Daily', 'Weekly', 'Manual', 'Safety'].map((d) => readdirSync(join(A, 'Backups', d)).sort());
  backups.forEach((list, i) => list.forEach((name) => expect(after[i]).toContain(name)));
});
