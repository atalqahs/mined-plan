# Performance findings

All numbers below were **measured**, not estimated. Raw output of the latest run is in
`docs/benchmarks/latest.json` (re-run with `npm run bench` after `npm run build`).

## Test environment (be careful reading the numbers)

| | |
|---|---|
| Machine | Cloud Linux container, 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, **no GPU** |
| Browser | Chromium 157.0.8103.78 (headless, Playwright 1.63.0) |
| WebGL | ANGLE → Vulkan → **SwiftShader** (CPU software rasteriser) |
| Viewport | 1920×1080, devicePixelRatio 1 |
| Data | Synthetic graph (`?bench=N`): ~N/25 primaries, depth ≤ 4, 12% of N cross-links, fully laid out, in-memory store |
| Method | 2.5 s warm-up, then the camera orbits continuously for 6 s; frame deltas are recorded inside `useFrame` |

Every pixel here is shaded on the CPU, so these numbers are a **worst case**, far below what any
desktop with a working GPU will see. They are still useful because software
rendering happens on real machines too (blocklisted drivers, VMs, remote desktops), and
because the relative costs show where the time goes. **No hardware-GPU measurements
were possible in this environment, and none are claimed.**

## Results — continuous orbit

`auto` = what users get (the app detected SwiftShader and picked the `low` tier).
`high` = forced `?quality=high` on the same software renderer.

| mode | tier | nodes | fps | p50 frame (ms) | p95 frame (ms) | select → paint (ms) | JS heap (MB) |
|---|---|---|---|---|---|---|---|
| auto | low | 100 | 28.2 | 34 | 43 | 61 | 17 |
| auto | low | 500 | 21.0 | 47 | 57 | 65 | 18 |
| auto | low | 1000 | 14.9 | 66 | 81 | 84 | 20 |
| high | high | 100 | 5.0 | 196 | 228 | 225 | 22 |
| high | high | 500 | 3.7 | 261 | 308 | 307 | 25 |
| high | high | 1000 | 2.9 | 337 | 401 | 381 | 78 |

JS heap is `performance.memory.usedJSHeapSize`. It is a coarse, GC-dependent sample
(the 78 MB outlier is a pre-GC reading), and it excludes GPU memory, which browsers do not expose.

## What changed because of these measurements

| Change | Before | After (1000 nodes, software) |
|---|---|---|
| Software-renderer detection → `low` tier (brain detail 62→28, DPR 1, no MSAA, fewer dust motes) | 2.4 fps | 7.7 fps |
| Node orb geometry 1,280 → 320 triangles (high) / 80 (low). At 1000 nodes the old orbs were 1.28 M triangles, and hover raycasting tested them too | 7.7 fps, p95 155 ms | 14.9 fps, p95 81 ms |
| Density-aware edge brightness, camera fit to the network's extent | visual clutter at 1000 nodes | legible overview (no fps change) |

Fixed bug found while measuring: `InstancedMesh.count` was set after the bounds were
computed, so after the first idea was added the bounding sphere was empty and picking
failed. It is now covered by an e2e test.

## CPU cost of hot paths (Node 22, same machine)

From `tests/unit/perf.test.ts` (mean of 3–5 runs after warm-up):

| operation | 100 | 500 | 1000 nodes |
|---|---|---|---|
| `buildSceneGraph` (all GPU arrays) | 0.08 ms | 0.46 ms | 0.84 ms |
| `computeEmphasis` (focus, 2 hops) | 0.03 ms | <0.01 ms | 0.01 ms |
| neighbourhood BFS incl. adjacency | 0.02 ms | 0.12 ms | 0.21 ms |
| `placeNewNode` | 0.22 ms | 0.13 ms | 0.08 ms |
| full re-layout | 1.1 ms | 4.4 ms | 23 ms |
| Arabic search | 0.24 ms | 1.1 ms | 2.4 ms |

The application logic is not a bottleneck at these sizes. In the 3D path,
draw calls stay constant (≈10) at every graph size: per-frame cost grows only with
vertex/pixel work and the O(n) label projection.

## Idle behaviour

* `frameloop="demand"`: with ambient motion off and nothing changing, **no frames render**.
* Ambient neural pulse (on by default): capped at 30 fps via `invalidate()`. Off under
  reduced motion and while the tab is hidden (`frameloop="never"`).

## How to reproduce

```bash
npm run build
npm run bench                               # writes docs/benchmarks/latest.json
BENCH_MODES=auto npm run bench              # only the auto-detected tier
```

Or open `/?bench=1000` (in-memory, never touches your data), optionally with `&quality=high`.
