import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { appendFileSync, mkdirSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DB_SCHEMA_VERSION } from '@/infrastructure/database/schemaVersion';
import { BACKUP_SCHEMA_VERSION } from '@/infrastructure/backup/jsonBackupCodec';
import { BackupStore, timeStamp, MAX_BACKUP_BYTES } from './backupStore';
import { decideSchema, hasDatabase, probeWritableSync, readState, snapshotProfile, writeState } from './dataGuard';
import { resolvePortableRoot } from './paths';
import { validateBackupText } from './validate';

/**
 * ORBITAL MIND — portable Windows desktop shell.
 *
 * Layout (next to "ORBITAL MIND.exe"):
 *   Data/Profile/   Chromium profile: IndexedDB (ideas), Local Storage (display preferences)
 *   Data/state.json schema/version record      Data/logs/  desktop + backup logs (no idea content)
 *   Backups/Daily | Weekly | Manual | Safety   independent verified JSON backups
 *
 * The web app is served from the bundled files under one fixed, trusted origin
 * (app://orbital-mind), so its IndexedDB and localStorage are found again on every
 * launch, after moving the folder to another computer, and after replacing the .exe.
 */

const ORIGIN = 'app://orbital-mind';
const HOST = 'orbital-mind';
/** Public website: the phone opens it when pairing with this computer's TV presentation. */
const PUBLIC_WEB_URL = 'https://atalqahs.github.io/mined-plan/';
/** The only remote host the renderer may contact (TV pairing signaling); everything else is local. */
const SIGNALING_HOSTS = new Set(['0.peerjs.com']);
/** Automated tests only: fatal errors go to stderr + exit code instead of a modal dialog. */
const TEST_MODE = process.env.ORBITAL_MIND_TEST === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// ---------------------------------------------------------------------------
// 1. Portable paths — must be set before the browser session is created.
// ---------------------------------------------------------------------------
const { root: ROOT, source: ROOT_SOURCE } = resolvePortableRoot(process.env, app.isPackaged, process.execPath, join(__dirname, '..', '.desktop-data'));
const DATA = join(ROOT, 'Data');
const PROFILE = join(DATA, 'Profile');
const LOGS = join(DATA, 'logs');
const BACKUPS = join(ROOT, 'Backups');
const DIST = resolve(__dirname, '..', 'dist-desktop');

app.setPath('userData', PROFILE);
app.setPath('sessionData', PROFILE);
app.setPath('crashDumps', join(PROFILE, 'Crashpad'));
app.setAppLogsPath(LOGS);
app.setAppUserModelId('com.orbitalmind.desktop');

function log(entry: Record<string, unknown>): void {
  try {
    mkdirSync(LOGS, { recursive: true });
    appendFileSync(join(LOGS, 'desktop.log'), `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* logging must never break the app */
  }
}
const backupLog = (entry: Record<string, string | number | boolean>) => {
  try {
    mkdirSync(LOGS, { recursive: true });
    appendFileSync(join(LOGS, 'backup.log'), `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* ignore */
  }
};

const FATAL_TEXT: Record<string, [string, string]> = {
  'data-unwritable': ['لا يمكن الكتابة في مجلد البيانات', 'مِدار يحفظ بياناتك في المجلد Data بجانب البرنامج، لكن هذا المجلد غير قابل للكتابة (قرص للقراءة فقط، أو صلاحيات غير كافية، أو مساحة ممتلئة).\n\nانقل مجلد «ORBITAL MIND» كاملًا إلى مكان قابل للكتابة (مثل المستندات أو سطح المكتب أو قرص USB) ثم شغّله من جديد. لم يُفتح البرنامج حتى لا تظن أن تغييراتك حُفظت.'],
  'backups-unwritable': ['لا يمكن الكتابة في مجلد النسخ الاحتياطية', 'المجلد Backups بجانب البرنامج غير قابل للكتابة، فلا يمكن حماية بياناتك بنسخ احتياطية.\n\nانقل مجلد «ORBITAL MIND» كاملًا إلى مكان قابل للكتابة ثم شغّله من جديد.'],
  'temporary-folder': ['شغّل البرنامج من مجلد دائم', 'يبدو أن البرنامج يعمل من مجلد مؤقت (مثل داخل ملف مضغوط). ستضيع البيانات المحفوظة هنا.\n\nفك الضغط عن مجلد «ORBITAL MIND» كاملًا إلى مكان دائم ثم شغّله من هناك.'],
  'newer-data': ['البيانات من إصدار أحدث', 'هذا المجلد يحوي بيانات أنشأها إصدار أحدث من مِدار. تشغيلها بهذا الإصدار الأقدم قد يتلفها، لذلك لن يُفتح البرنامج.\n\nاستخدم الإصدار الأحدث من «ORBITAL MIND.exe». لم يُعدَّل أي شيء في بياناتك.'],
  'pre-upgrade-backup': ['تعذّر إنشاء نسخة أمان قبل الترقية', 'قبل تحديث بنية قاعدة البيانات يجب حفظ نسخة كاملة منها، وقد تعذّر ذلك. لم تُعدَّل بياناتك.\n\nتأكد من وجود مساحة كافية وأن المجلد قابل للكتابة، ثم أعد التشغيل.'],
  'storage-failed': ['تعذّر فتح قاعدة البيانات', 'لم يتمكن مِدار من فتح بياناتك المحفوظة في المجلد Data، لذلك أُغلق حتى لا تُفقد أي تغييرات.\n\nنسخك الاحتياطية في المجلد Backups سليمة. راجع دليل الاستخدام: «استعادة نسخة احتياطية».'],
};

function fatal(code: keyof typeof FATAL_TEXT, detail = ''): void {
  log({ event: 'fatal', code, detail });
  if (TEST_MODE) process.stderr.write(`ORBITAL_FATAL ${code} ${detail}\n`);
  else {
    const [title, body] = FATAL_TEXT[code];
    dialog.showErrorBox(`مِدار — ${title}`, body + (detail ? `\n\n(${detail})` : '') + `\n\n${ROOT}`);
  }
  app.exit(3);
}

const isInside = (child: string, parent: string) => {
  const c = resolve(child) + sep;
  const p = resolve(parent) + sep;
  return process.platform === 'win32' ? c.toLowerCase().startsWith(p.toLowerCase()) : c.startsWith(p);
};

// Storage checks come first: never start on a folder that cannot keep the data
// (and never fail silently — the lock below would otherwise fail without a message).
// Probe the folders Chromium itself must create (Data\Profile) as well as Data and logs.
const dataProbe = [DATA, PROFILE, LOGS].map(probeWritableSync).find((r) => !r.ok) ?? { ok: true as const };
const backupsProbe = dataProbe.ok ? probeWritableSync(BACKUPS) : dataProbe;
if (!dataProbe.ok) fatal('data-unwritable', (dataProbe as { code: string }).code);
else if (!backupsProbe.ok) fatal('backups-unwritable', backupsProbe.code);
else if (ROOT_SOURCE === 'executable' && isInside(ROOT, tmpdir()) && !TEST_MODE) fatal('temporary-folder');
// One running copy per Data folder (two copies writing one database would corrupt it).
else if (!app.requestSingleInstanceLock()) {
  log({ event: 'already-running' });
  app.exit(0);
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(start, (e) => fatal('storage-failed', String(e)));
}

let store: BackupStore;
let storageReady = false;

// ---------------------------------------------------------------------------
// 2. Start-up checks (before any page — and therefore any database — is opened).
// ---------------------------------------------------------------------------
async function start(): Promise<void> {
  log({ event: 'start', version: app.getVersion(), root: ROOT, rootSource: ROOT_SOURCE, platform: process.platform, arch: process.arch });
  store = new BackupStore(BACKUPS, validateBackupText, backupLog);
  await store.ensureDirs();
  await store.cleanupTemp();

  const state = await readState(DATA);
  const decision = decideSchema(state, await hasDatabase(PROFILE), DB_SCHEMA_VERSION);
  log({ event: 'schema', decision, stored: state && state !== 'corrupt' ? state.dbSchema : String(state), current: DB_SCHEMA_VERSION });
  if (decision === 'newer') return fatal('newer-data', `v${(state as { dbSchema: number }).dbSchema} > v${DB_SCHEMA_VERSION}`);
  if (decision === 'upgrade' || decision === 'unknown') {
    // Verified copy of the closed database before this program opens (and may migrate) it.
    const dest = join(BACKUPS, 'Safety', `database-before-v${DB_SCHEMA_VERSION}_${timeStamp(new Date())}`);
    const snap = await snapshotProfile(PROFILE, dest);
    backupLog({ event: 'profile-snapshot', reason: decision, result: snap.ok ? 'ok' : 'failed', ...(snap.ok ? { files: snap.files } : { error: snap.code }) });
    if (!snap.ok) return fatal('pre-upgrade-backup', snap.code);
  }

  registerProtocol();
  lockDownSession();
  registerIpc();
  createWindow();
}

// ---------------------------------------------------------------------------
// 3. Bundled app under a fixed trusted origin.
// ---------------------------------------------------------------------------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${[...SIGNALING_HOSTS].map((h) => `https://${h} wss://${h}`).join(' ')}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function registerProtocol(): void {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (path === '/' || path === '') path = '/index.html';
    const file = resolve(DIST, `.${path}`);
    if (!isInside(file, DIST)) return new Response('Not found', { status: 404 });
    try {
      if (!(await fs.stat(file)).isFile()) return new Response('Not found', { status: 404 });
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers({ 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: 200, headers });
  });
}

function lockDownSession(): void {
  const ses = session.defaultSession;
  const allowed = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write', 'persistent-storage']);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission) && wc.getURL().startsWith(`${ORIGIN}/`)));
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && (origin ?? '').startsWith(ORIGIN));
  // No network access except the TV-pairing signaling server: user data never leaves this computer.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    let host = '';
    try {
      host = new URL(details.url).hostname;
    } catch {
      /* blocked below */
    }
    const ok = SIGNALING_HOSTS.has(host);
    if (!ok) log({ event: 'blocked-request', host });
    cb({ cancel: !ok });
  });
}

// ---------------------------------------------------------------------------
// 4. Window + navigation restrictions + safe close.
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let allowClose = false;

function createWindow(): void {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#070809',
    title: 'مِدار — Orbital Mind',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged || TEST_MODE,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => {
    if (!TEST_MODE) win.maximize();
    win.show();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => log({ event: 'renderer-gone', reason: d.reason }));
  // The page's own "unsaved changes" guard is replaced by an explicit flush (below).
  win.webContents.on('will-prevent-unload', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    void flushBeforeClose(win.webContents).then((ok) => {
      if (!ok && !TEST_MODE) {
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          buttons: ['الانتظار ومحاولة الحفظ مجددًا', 'إغلاق دون حفظ آخر التغييرات'],
          defaultId: 0,
          cancelId: 0,
          title: 'مِدار',
          message: 'لم تُحفظ آخر التغييرات بعد',
          detail: 'تعذّرت كتابة آخر التغييرات في المجلد Data. إن أغلقت الآن فقد تضيع هذه التغييرات الأخيرة فقط؛ تبقى البيانات المحفوظة سابقًا والنسخ الاحتياطية سليمة.',
        });
        if (choice === 0) return;
      }
      log({ event: 'close', flushed: ok });
      allowClose = true;
      win.close();
    });
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  void win.loadURL(`${ORIGIN}/index.html`);
}

/** Ask the page to write every pending change to IndexedDB before the window closes. */
function flushBeforeClose(wc: WebContents): Promise<boolean> {
  const remember = (nodes: number) => {
    // Awaited before the window closes: the app must not exit before this record is on disk.
    if (!storageReady || nodes < 0) return Promise.resolve();
    return readState(DATA)
      .then((s) => (s && s !== 'corrupt' ? writeState(DATA, { ...s, lastNodeCount: nodes }) : undefined))
      .catch((err) => log({ event: 'state-write-failed', code: (err as NodeJS.ErrnoException).code }));
  };
  return new Promise((resolveFlush) => {
    if (wc.isDestroyed() || wc.isCrashed()) return resolveFlush(false);
    const timer = setTimeout(() => {
      ipcMain.removeListener('desktop:before-close-done', onDone);
      resolveFlush(false);
    }, 10_000);
    const onDone = (e: Electron.IpcMainEvent, r: unknown) => {
      if (e.sender !== wc) return;
      clearTimeout(timer);
      ipcMain.removeListener('desktop:before-close-done', onDone);
      const res = r as { ok?: unknown; nodes?: unknown } | null;
      const ok = res?.ok === true;
      if (ok && typeof res?.nodes === 'number') void remember(res.nodes).then(() => resolveFlush(true));
      else resolveFlush(ok);
    };
    ipcMain.on('desktop:before-close-done', onDone);
    wc.send('desktop:before-close');
  });
}

app.on('web-contents-created', (_e, wc) => {
  const sameApp = (url: string) => url.startsWith(`${ORIGIN}/`);
  wc.on('will-navigate', (e, url) => {
    if (!sameApp(url)) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!sameApp(url)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------------------
// 5. Narrow IPC surface (portable storage status + backups). No generic file access.
// ---------------------------------------------------------------------------
function trusted(e: IpcMainInvokeEvent): boolean {
  return !!mainWindow && e.sender === mainWindow.webContents && (e.senderFrame?.url ?? '').startsWith(`${ORIGIN}/`);
}
function backupText(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_BACKUP_BYTES) throw new Error('invalid backup payload');
  return v;
}
const publicResult = <T extends { ok: boolean }>(r: T) => ('path' in r ? { ...r, path: undefined } : r);

function registerIpc(): void {
  ipcMain.handle('desktop:info', (e) => {
    if (!trusted(e)) throw new Error('untrusted');
    return { version: app.getVersion(), dataDir: DATA, backupsDir: BACKUPS, publicUrl: PUBLIC_WEB_URL, rootSource: ROOT_SOURCE, backupSchema: BACKUP_SCHEMA_VERSION };
  });
  ipcMain.handle('desktop:backup-due', async (e) => {
    if (!trusted(e)) throw new Error('untrusted');
    return store.due();
  });
  ipcMain.handle('desktop:backup-auto', async (e, text: unknown) => {
    if (!trusted(e) || !storageReady) throw new Error('untrusted');
    const r = await store.writeAuto(backupText(text));
    return { daily: r.daily && publicResult(r.daily), weekly: r.weekly && publicResult(r.weekly) };
  });
  ipcMain.handle('desktop:backup-manual', async (e, text: unknown) => {
    if (!trusted(e) || !storageReady) throw new Error('untrusted');
    return publicResult(await store.writeManual(backupText(text)));
  });
  ipcMain.handle('desktop:backup-safety', async (e, text: unknown) => {
    if (!trusted(e) || !storageReady) throw new Error('untrusted');
    return publicResult(await store.writeSafety(backupText(text), 'before-import'));
  });
  // The user picked this file in the native "open" dialog; only a status is returned, never content.
  ipcMain.handle('desktop:check-file', async (e, path: unknown) => {
    if (!trusted(e)) throw new Error('untrusted');
    if (typeof path !== 'string' || !path || path.length > 4096 || !/\.json$/i.test(path)) return 'unreadable';
    return store.checkFile(path);
  });
  ipcMain.handle('desktop:storage', async (e, status: unknown) => {
    if (!trusted(e)) throw new Error('untrusted');
    const s = status as { ok?: unknown; code?: unknown; nodes?: unknown };
    if (s?.ok !== true) {
      fatal('storage-failed', typeof s?.code === 'string' ? s.code.slice(0, 120) : 'unknown');
      return false;
    }
    if (!storageReady) {
      storageReady = true;
      const prev = await readState(DATA);
      const now = new Date().toISOString();
      const nodes = typeof s.nodes === 'number' ? s.nodes : -1;
      const before = prev && prev !== 'corrupt' ? (prev.lastNodeCount ?? 0) : 0;
      if (before > 0 && nodes === 0) warnEmptyDatabase(before);
      await writeState(DATA, {
        format: 1,
        dbSchema: DB_SCHEMA_VERSION,
        backupSchema: BACKUP_SCHEMA_VERSION,
        appVersion: app.getVersion(),
        createdAt: prev && prev !== 'corrupt' ? prev.createdAt : now,
        lastOpenedAt: now,
        lastNodeCount: prev && prev !== 'corrupt' ? prev.lastNodeCount : undefined,
      }).catch((err) => log({ event: 'state-write-failed', code: (err as NodeJS.ErrnoException).code }));
      log({ event: 'storage-ready' });
      if (process.env.ORBITAL_MIND_SELFTEST_OUT) setTimeout(() => void selfTestReport(), 6000);
    }
    return true;
  });
}

/** The Data folder had ideas when last closed but opened empty: never let that pass silently. */
function warnEmptyDatabase(before: number): void {
  log({ event: 'empty-after-data', before });
  if (TEST_MODE) return void process.stderr.write(`ORBITAL_WARNING empty-after-data ${before}\n`);
  if (!mainWindow) return;
  void dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'مِدار',
    message: 'لم يُعثر على أفكارك المحفوظة',
    detail: `كان هذا المجلد يحوي ${before} فكرة عند آخر إغلاق، لكن قاعدة البيانات فُتحت فارغة. لم يُحذف شيء من نسخك الاحتياطية، ولن تُنشأ نسخ تلقائية من شبكة فارغة.\n\nللاستعادة: الإعدادات ← استيراد JSON، ثم اختر أحدث ملف من المجلد:\n${join(BACKUPS, 'Daily')}`,
    buttons: ['حسنًا'],
  });
}

// ---------------------------------------------------------------------------
// 6. Self-test report (used by the Windows CI job against the real portable .exe).
//    Read-only and content-free: counts and a hash of ids + positions only.
// ---------------------------------------------------------------------------
async function selfTestReport(): Promise<void> {
  const out = process.env.ORBITAL_MIND_SELFTEST_OUT!;
  const wc = mainWindow?.webContents;
  let graph: unknown = null;
  try {
    graph = await wc?.executeJavaScript(
      `(async () => { const o = window.__orbital; await o.flush(); const ids = o.ids().sort(); return { nodes: ids.length, rendered: o.rendered(), fingerprint: ids.map((id) => id + ':' + JSON.stringify(o.positionOf(id))).join('|') }; })()`,
    );
  } catch (err) {
    graph = { error: String(err) };
  }
  const g = graph as { fingerprint?: string } | null;
  const list = async (d: string) => (await fs.readdir(join(BACKUPS, d)).catch(() => [] as string[])).sort();
  const report = {
    root: ROOT,
    rootSource: ROOT_SOURCE,
    execPath: process.execPath,
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR ?? null,
    dataDir: DATA,
    profileDir: app.getPath('userData'),
    sessionDir: app.getPath('sessionData'),
    origin: wc?.getURL() ?? null,
    graph: g && typeof g.fingerprint === 'string' ? { ...g, fingerprint: createHash('sha256').update(g.fingerprint).digest('hex') } : graph,
    backups: { daily: await list('Daily'), weekly: await list('Weekly'), manual: await list('Manual'), safety: await list('Safety') },
    gpu: app.getGPUFeatureStatus(),
  };
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  allowClose = false;
  mainWindow?.close();
}
