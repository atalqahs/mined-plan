# ORBITAL MIND — Windows desktop (portable)

The same app as the website, packaged with Electron as a portable Windows x64 program.
It needs no browser, no internet (except for TV pairing), no installation and no account.
All data lives in the program's own folder, so the folder can be moved between computers.
The Arabic user guide is [`DESKTOP_GUIDE_AR.txt`](DESKTOP_GUIDE_AR.txt); it ships inside the zip as «دليل الاستخدام.txt».

## Portable layout

```
ORBITAL MIND/
├── ORBITAL MIND.exe        the program (self-extracting portable launcher)
├── Data/                   authoritative user data; travels with the program
│   ├── Profile/            Chromium profile: IndexedDB (ideas, links, reminders, internal
│   │                       safety copies) + Local Storage (display preferences)
│   ├── state.json          DB schema / backup schema / program version / last idea count
│   └── logs/               desktop.log, backup.log (no idea titles or notes)
└── Backups/
    ├── Daily/   2026-11-19.json  (+ .sha256)   automatic, newest 7 kept
    ├── Weekly/  2026-W47.json    (+ .sha256)   automatic, ISO week, newest 4 kept
    ├── Manual/  ORBITAL-MIND_2026-11-19_14-30-05.json   "تصدير نسخة JSON"; never deleted
    └── Safety/  before-import_….json · database-before-vN_…/   never deleted
```

## How portable storage works

| Concern | Implementation (`desktop/main.ts`) |
|---|---|
| Data root | `PORTABLE_EXECUTABLE_DIR` (set by electron-builder's portable launcher to the folder of the **original** .exe). Without it, the folder of the running executable (unpacked build). `process.execPath` of the portable build points at the temporary extraction folder in `%TEMP%` and is never used. Tested with the real portable .exe on Windows (see below). |
| Before the session starts | `userData`, `sessionData`, `crashDumps` and the logs path are set to `Data/` at module load, before `app.ready`. Nothing is written to `%APPDATA%` (asserted by the tests). |
| Stable origin | The bundled build is served by a privileged, secure, standard scheme: `app://orbital-mind/`. IndexedDB and localStorage are keyed by that origin, so they are found again after a restart, a move to another folder or computer, and a program update. |
| Storage engine | Dexie + IndexedDB are kept unchanged (no SQLite migration). Chromium's IndexedDB (LevelDB) and Local Storage files are plain files, independent of the machine (not encrypted with Windows DPAPI). |
| Never on temporary storage | Before Chromium starts, `Data/` and `Backups/` must accept a durable write (write + fsync + read-back). Otherwise the program shows an Arabic error and exits. It also refuses to run from a temporary folder, for example inside a zip. If IndexedDB cannot be opened, the page reports it and the program shows an error and closes, instead of the website's in-memory fallback. |
| One writer | A single-instance lock per Data folder. A second launch focuses the running window. |
| Safe close | Closing the window first asks the page to write every pending change. If that fails, the user is asked before closing. |
| Schema versions | `Data/state.json` records the IndexedDB schema version (`DB_SCHEMA_VERSION`, kept equal to Dexie's `verno` by a unit test). Newer data → refuse to run, nothing touched. Older or unknown data → a **verified file copy** of `IndexedDB` + `Local Storage` goes to `Backups/Safety/database-before-vN_…` before the database is opened, and the program aborts if that copy fails. |
| Empty database | If a Data folder that had ideas at the last close opens empty, the user is warned and pointed to the backups. Automatic backups are never made from an empty graph, so good backups are never rotated out. |

## Backups (`desktop/backupStore.ts`)

- **Format:** every backup is the app's standard JSON backup document (schema v2). It can be imported by the existing «استيراد نسخة JSON» button on any computer, including the website. Desktop backups add a `preferences` block (display settings), which older importers ignore and the desktop import restores.
- **Consistency:** the page waits for pending writes (`store.flush()`) and refuses if writes are failing. It then reads the **persisted** records back from IndexedDB (not the in-memory view) and encodes them.
- **Integrity:**
  1. The main process validates the content with the same codec the importer uses, and rejects any invalid record.
  2. It writes to `name.tmp-…`, fsyncs and reads the file back.
  3. It compares the SHA-256 of what is on disk and validates it again.
  4. It writes `name.json.sha256` (`sha256sum` format; `certutil -hashfile` works too).
  5. It then renames into place (no overwrite) and syncs the directory where supported.
  6. Leftover temporary files from an interrupted backup are removed at the next start.
- **Retention:** runs only after a new backup has been verified, and only in its own folder. Daily keeps the newest 7 and weekly the newest 4. Manual and Safety are never pruned. Days the program is not opened produce no backup. A session left open past midnight is checked hourly.
- **Restore:** the existing import. In the desktop build:
  1. A file whose `.sha256` does not match is rejected as corrupted.
  2. A verified safety backup of the current data is written to `Backups/Safety` before anything is replaced. If that fails, the import is cancelled.
  3. The existing import validation, repair report and undo apply unchanged.
- **Logs:** `Data/logs/backup.log` holds the time, category, file name (a date), result, size and counts. It never contains titles or notes.

## Migration from the website (one time)

1. Website → الإعدادات → «تصدير نسخة JSON». Keep that file as an independent backup.
2. Run `ORBITAL MIND.exe` → الإعدادات → «استيراد نسخة JSON» → «استبدل الشبكة». If the desktop already holds ideas, a safety backup of them is written first.
3. Close and reopen the program and check the data.

What the website's JSON contains: ideas (ids, titles, descriptions/notes, parents, categories, 3D positions, colours, status, deadlines, timestamps), cross-links and reminders. It does **not** contain the display preferences (label density, motion, ambient pulse). Set those once in the desktop app; they are then included in every desktop backup. The website's own IndexedDB is never read, changed or deleted by the desktop app.

## Moving between computers

Close the program and copy the whole `ORBITAL MIND` folder. On the other computer, run the .exe from the copied folder; no import is needed. Copies are **not synchronised**: if both copies are edited, they diverge and nothing is merged. Always carry the latest folder back. Never replace a newer folder with an older one.

## Updating the program

Close the program and replace only `ORBITAL MIND.exe` (unpacked builds: everything except `Data` and `Backups`). The origin and the Data layout stay the same. A schema upgrade, if a future version has one, is preceded by the verified database copy described above. An older program refuses newer data. There is no online auto-update.

## Security

`contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. The preload exposes eight fixed functions (storage status, backup status, three backup writes, a checksum check of a file the user picked, close handshake, info). There is no generic filesystem or IPC access, and every IPC call checks that it comes from the app's own page.
- Every response from the app's own origin carries a strict Content-Security-Policy.
- Navigation away from `app://orbital-mind`, pop-ups and `<webview>` are blocked.
- Network requests are cancelled except to the TV-pairing signaling host (`0.peerjs.com`).
- Permissions are limited to notifications, fullscreen and clipboard writes.
- DevTools are disabled in the packaged app (they stay available in development and automated tests).
- The packaged app contains only the bundled code (≈ 3 MB asar, no `node_modules`).

## Offline

Everything is bundled: the app code, Three.js, both Arabic fonts (Fontsource), and the procedural brain and lighting (no environment maps fetched). The tests run with all non-signaling network access blocked. **TV mode and the phone controller still need the internet** for pairing (the public PeerJS signaling server). On the desktop, the QR code points the phone to the public website.

## Building

```bash
npm run dist:win        # Windows portable .exe  → release/ORBITAL MIND.exe
```

```bash
npm run dist:win-dir    # unpacked Windows build → release/win-unpacked
```

```bash
npm run dist:linux-dir  # unpacked Linux build (used by the tests in Linux CI / containers)
```

Cross-building the Windows .exe on Linux works, but without `wine` the icon and version info are not applied: add `-c.win.signAndEditExecutable=false`. The published build is made on Windows by `.github/workflows/desktop-windows.yml`.

## Tests

| Suite | What it proves |
|---|---|
| `tests/unit/desktopBackups.test.ts` | Naming (local day, ISO week incl. year edges). Daily and weekly creation once per period. Retention 7/4 over 40 simulated days, independent per category. Manual never pruned, no overwrite. No artificial backups. Invalid snapshot refused. Read-only folder fails without pruning. No partial files. Interrupted-backup cleanup. Checksum, truncated and unverified detection. Disk full (ENOSPC on a tiny tmpfs). Portable-root resolution. Schema-version constant. |
| `tests/desktop/desktop.spec.ts` (packaged app) | Portable layout, `app://` origin, nothing in AppData. No Node in the page; pop-ups, outside fetches and navigation blocked; offline fonts. Realistic Arabic graph imported, edited, closed, relaunched: every field preserved, including deadlines, reminders, colours and positions. Display preference persisted. Manual backup verified. Daily/weekly backups verified. Folder copied to B: same data, edits persist, A unaffected. `PORTABLE_EXECUTABLE_DIR` root. Restore from daily: same ids and positions, safety copy first, tampered and truncated backups rejected. Program update keeps Data and Backups. Newer data refused untouched. Older schema snapshotted first. Unusable Data/Backups reported. Read-only Data (where enforceable). Empty-database warning with no empty backup. High-DPI, resize, F11 fullscreen, presentation view, minimise/restore. |
| `tests/desktop/portable-exe.spec.ts` (Windows only) | The **real single-file portable .exe**: runs from `%TEMP%` but stores everything next to itself. The folder is copied to another path, including a non-ASCII one: same data, edits persist, copies independent. Replacing the .exe with a newer version keeps Data and Backups. |
