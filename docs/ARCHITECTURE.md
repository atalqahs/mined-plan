# ORBITAL MIND — Architecture

## Layers and dependency rule

```
presentation  ──►  application  ──►  domain
     │                  ▲
     └──► app/bootstrap ┴──►  infrastructure  ──►  application (ports) + domain
design-system  (tokens + generic components; imported by presentation only)
shared         (framework-free utilities; importable by anyone)
```

Dependencies point inward. Concretely:

| Layer | May import | Must not import |
|---|---|---|
| `domain/` | `shared/` | React, Three.js, Dexie, Zod, anything in `application/`, `infrastructure/`, `presentation/` |
| `application/` | `domain/`, `shared/` | React, Three.js, Dexie, Zod, `infrastructure/`, `presentation/` |
| `infrastructure/` | `application/ports`, `application/patch`, `domain/`, Dexie, Zod | React, Three.js, `presentation/` |
| `presentation/` | everything above via the `AppContainer` interface, React, R3F, Three.js, Zustand | Dexie, repositories, Zod schemas |
| `design-system/` | React | domain, application, infrastructure |

`app/bootstrap/container.ts` is the only composition root: it picks the
repository (IndexedDB, or memory as a fallback), creates the services and hands
the presentation layer an `AppContainer`. Replacing storage means writing a new
`MindRepository` and changing one line there.

## Directory map

```
src/
├── app/
│   ├── bootstrap/        composition root, sample + benchmark data, test/debug hooks
│   └── providers/        React context binding (useSyncExternalStore over GraphStore)
├── domain/               pure TypeScript — no frameworks
│   ├── entities/         MindNode / MindEdge / MindReminder, factories
│   ├── graph/            hierarchy rules (cycle prevention), neighbourhood (focus), layout, integrity repair
│   ├── reminders/        timezone-aware recurrence, bucket classification
│   └── rules/            validation + DomainError codes (no UI copy)
├── application/
│   ├── commands/         MindCommands: every write, validated, as a Patch
│   ├── queries/          search (Arabic-normalised), reminder groups, relations
│   ├── services/         GraphStore (state + persistence queue + undo), ReminderScheduler, BackupService
│   ├── ports/            MindRepository, Notifier, BackupCodec, Clock interfaces
│   └── patch.ts          Patch model: apply / invert
├── infrastructure/
│   ├── database/         DexieRepository (versioned IndexedDB schema, quarantine, backups), MemoryRepository
│   ├── backup/           JsonBackupCodec (Zod validation + document migrations)
│   ├── notifications/    BrowserNotifier (Web Notifications API)
│   └── schemas.ts        Zod schemas for everything crossing a trust boundary
├── presentation/
│   ├── scene3d/          everything WebGL (lazy-loaded chunk)
│   │   ├── brain/        procedural brain geometry + material, plinth
│   │   ├── nodes/        instanced node field, halos, DOM label layer
│   │   ├── connections/  hierarchy lines + cross-link arcs
│   │   ├── camera/       camera rig (fly / focus / restore), view offset
│   │   ├── orbit/        orbit shells, dust
│   │   ├── sceneModel.ts SceneGraph + Emphasis read model (the scene's only input)
│   │   └── SceneContainer.tsx  adapter: app state → scene props, scene intents → commands
│   ├── panels/           details, notification centre, settings, add-idea
│   ├── ui/               toolbar, search, toasts, confirm dialog, banners
│   ├── hooks/            shortcuts, safe command runner, drafts, reminder bridge
│   ├── state/            Zustand UI store (selection, panels, focus, prefs)
│   └── i18n/ar.ts        all Arabic copy + formatting (Gregorian, Latin digits)
├── design-system/        tokens.css, palette.ts, fonts, Button / Field / Icon / Kbd, bevel.css
└── shared/               id, Arabic normalisation, Result type
```

## Data flow

```
user action ─► presentation handler ─► MindCommands.x()          (validates with domain rules)
                                        └─► GraphStore.commit(label, patch)
                                             ├─ invertPatch → undo stack (optionally coalesced)
                                             ├─ applyPatch → new immutable snapshot → subscribers re-render
                                             └─ enqueue patch → repository.applyPatch (in order, retried)
```

* **Patch** (`application/patch.ts`) is the unit of change. Every command emits
  one; persistence writes it in a single IndexedDB transaction; undo is the
  inverse patch computed against the pre-change snapshot.
* **Snapshots** are immutable with structural sharing (unchanged tables keep
  identity), so React subscribers and `useMemo` dependencies are cheap.
* **Persistence** is optimistic and ordered. A failed write keeps the patch
  queued and retries with exponential backoff; the toolbar shows the save state
  and `beforeunload` warns while writes are pending.

## Graph model

* Hierarchy lives in `MindNode.parentId`. `assertValidParent` rejects self-parenting
  and cycles (walks ancestors). Cross-connections are separate `MindEdge` records,
  undirected for uniqueness (`edgePairKey`), and may form cycles.
* Re-parenting (`moveNode`) changes only `parentId` + positions of the moved
  branch; edges reference ids and are untouched.
* Deleting offers *cascade* (subtree) or *promote children* (re-attach to the
  grandparent). Edges and reminders of removed nodes are deleted in the same patch,
  so one undo restores everything.
* `MindNode.deadline` is an extension of the brief's model (the brief's detail panel
  requires a deadline).

## Layout

`domain/graph/layout.ts`, pure math:

* New primaries take the best of 96 Fibonacci-sphere candidates (max-min distance
  to existing primaries). Children are spread on an outward cone around their parent
  with a depth-decaying shell radius. **Existing nodes never move** when a node is
  added (persistent spatial memory).
* "Redistribute network" (`computeFullLayout`) is explicit, deterministic, size-aware
  and finishes with a spatial-hash repulsion pass. It is undoable.
* Nothing may enter the brain's keep-out sphere (`LAYOUT.coreRadius`).
* Dragging moves the subtree rigidly; on release one `repositionNode` patch is committed.

## Focus Mode

`computeEmphasis(graph, selectedId, focus)` (presentation/scene3d/sceneModel.ts) runs a
BFS over the undirected union of hierarchy + cross edges (`domain/graph/neighborhood.ts`)
to depth 1 (direct) or 2 (extended). It returns per-node target brightness; the
scene eases toward it in `useFrame`. Nothing is hidden or moved: unrelated ideas
are dimmed to ~10% brightness and unrelated edges to ~3.5%. The camera rig saves
the pose on entry, frames a weighted centre with a robust radius (70th percentile, so
one distant cross-link doesn't pull the camera away), and restores the pose on exit.

## Rendering architecture

* **One lazy chunk** for Three.js/R3F/Drei (`SceneRoot` via `React.lazy`). The main
  chunk has no Three.js import (scene colours use a local sRGB→linear helper).
* **Demand rendering** (`frameloop="demand"`). Frames are produced only for camera
  motion, easing, drags or the optional 30 fps ambient pulse. `frameloop="never"`
  while the tab is hidden.
* **Draw calls are constant in graph size:** all ideas = 1 `InstancedMesh` with a
  custom rim-lit shader and per-instance colour/emphasis/selection attributes; all
  hierarchy lines = 1 `LineSegments`; all cross-links = 1 dashed `LineSegments`;
  brain = 1 merged mesh.
* **No per-frame React state.** Emphasis easing, drag positions, label placement and
  frame statistics live in refs or the mutable `sceneRuntime`.
* **Labels** are pooled DOM elements (correct Arabic shaping + bidi), positioned
  imperatively. A priority + screen-space collision pass picks at most 16 / 44 / 110
  labels (density setting); selection, hover and focus neighbours always win. Every
  node stays rendered; only text is culled.
* **Render tiers** (`gpuTier.ts`): software rasterisers (SwiftShader, llvmpipe, WARP)
  get lower brain tessellation, 80-triangle node orbs, DPR 1 and no MSAA. `?quality=high|low` overrides.
* Owned GPU resources (geometries/materials created in `useMemo`) are disposed in effect cleanups.

## Storage migrations

* **IndexedDB** (`OrbitalDatabase`): Dexie versions are append-only. v1 = initial
  tables; v2 adds `quarantine` + `backups` and normalises reminder fields in an
  `.upgrade()`. Add v3 with its own upgrade; never edit a published version.
* **Backup documents** carry `schemaVersion`. `jsonBackupCodec.migrations[v]` upgrades
  v→v+1 (v1→v2 maps `notified: boolean` → `notificationState`). Files from a newer
  app version are refused rather than guessed at.

## Data safety

* Every record read from IndexedDB is validated with Zod. Invalid rows are **moved to
  the `quarantine` table** (not deleted) and the user is told.
* `repairSnapshot` re-attaches orphans, breaks hierarchy cycles and sets aside
  dangling/duplicate edges and reminders, reporting each class.
* Import: parse → migrate → validate per record → repair → preview (counts + issues)
  → explicit confirmation → automatic local safety backup (last 10 kept) → replace as
  one undoable step.
* If IndexedDB cannot be opened (e.g. some private modes), the app runs on the
  memory repository and shows a persistent warning to export.

## Reminders

`ReminderScheduler` (application layer, injectable clock + timers):

* On start, pending reminders already due are marked `missed` and reported once.
* While running, it sleeps until the next due time but never longer than 30 s
  (background-tab timer throttling), and re-checks on `visibilitychange`/`focus`.
* Due reminders are marked `notified` (bookkeeping is not undoable history) and
  delivered as an in-app toast plus a native notification when permitted.
* Recurrence keeps wall-clock time in the reminder's own IANA zone across DST;
  monthly/yearly clamp to month end while remembering the anchor day.
* Completing a recurring reminder advances it past `now` (backlog skipped).

## Testing

* `tests/unit` (Vitest, Node): domain rules, layout, recurrence/DST, scheduler,
  store/undo/coalescing/retry, backup codec + migrations, Dexie via fake-indexeddb,
  Arabic search, CPU timings of hot paths.
* `tests/e2e` (Playwright, Chromium): RTL/Arabic, create + reload persistence, focus
  levels, keyboard undo/redo, delete confirmation + undo, reminders + notifications
  (stubbed API), export/import incl. invalid files, 3D click-select and drag-move.
* `tests/bench` (Playwright): frame-time benchmark at 100/500/1000 nodes.
