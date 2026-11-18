import type { GraphSnapshot, MindNode, Vec3 } from '../entities/types';
import { buildChildIndex, getDescendantIds } from './hierarchy';

/**
 * Pure spatial layout for the orbital network. Units are abstract world units;
 * the presentation layer decides scale. No Three.js here — plain vector math.
 */
export const LAYOUT = {
  /** Radius of the keep-out sphere around the central brain (brain surface ≈ 7.4, so ≈ 2.8 units of clear "atmosphere"). */
  coreRadius: 10.2,
  /** Orbit radius of primary ideas: the middle of the "atmosphere" shell around the brain. */
  primaryRadius: 12.6,
  /** Shell radius of first-level children around their parent. */
  childRadius: 3.0,
  /** Each deeper level shrinks its shell by this factor. */
  depthFalloff: 0.72,
  minChildRadius: 1.2,
} as const;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const dist2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-9 ? [0, 1, 0] : scale(a, 1 / l);
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const round = (v: Vec3): Vec3 => [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000];

/** Evenly distributed direction i of n on the unit sphere (Fibonacci lattice), slightly flattened vertically. */
export function fibonacciDirection(i: number, n: number): Vec3 {
  const y = n <= 1 ? 0.25 : 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * i;
  return normalize([Math.cos(theta) * r, y * 0.78, Math.sin(theta) * r]);
}

/** Direction i of n spread over a cone of half-angle `spread` around `axis`. */
function coneDirection(axis: Vec3, i: number, n: number, spread: number): Vec3 {
  const a = normalize(axis);
  const helper: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(a, helper));
  const v = cross(a, u);
  const t = n <= 1 ? 0 : (i + 0.5) / n;
  const polar = spread * Math.sqrt(t);
  const az = GOLDEN * i;
  const s = Math.sin(polar);
  return normalize(add(add(scale(a, Math.cos(polar)), scale(u, s * Math.cos(az))), scale(v, s * Math.sin(az))));
}

export function shellRadius(depth: number): number {
  return Math.max(LAYOUT.minChildRadius, LAYOUT.childRadius * LAYOUT.depthFalloff ** Math.max(0, depth - 1));
}

function keepOutOfCore(p: Vec3): Vec3 {
  const l = len(p);
  return l < LAYOUT.coreRadius ? scale(normalize(p), LAYOUT.coreRadius) : p;
}

/** Pick the candidate maximising its minimum distance to `occupied` points. */
function bestCandidate(candidates: Vec3[], occupied: Vec3[]): Vec3 {
  if (!occupied.length) return candidates[0];
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    let min = Infinity;
    for (const o of occupied) {
      const d = dist2(c, o);
      if (d < min) min = d;
    }
    if (min > bestScore) {
      bestScore = min;
      best = c;
    }
  }
  return best;
}

/**
 * Incremental placement for a newly created node. Existing nodes never move,
 * which keeps the user's spatial memory (persistent layouts) intact.
 */
export function placeNewNode(snapshot: GraphSnapshot, parentId: string | null): Vec3 {
  const nodes = snapshot.nodes;
  const occupied = [...nodes.values()].map((n) => n.position);
  if (!parentId || !nodes.has(parentId)) {
    const candidates = Array.from({ length: 96 }, (_, i) => scale(fibonacciDirection(i, 96), LAYOUT.primaryRadius));
    const primaries = [...nodes.values()].filter((n) => !n.parentId).map((n) => n.position);
    return round(bestCandidate(candidates, primaries.length ? primaries : occupied));
  }
  const parent = nodes.get(parentId)!;
  const grand = parent.parentId ? nodes.get(parent.parentId) : undefined;
  const axis = sub(parent.position, grand ? grand.position : [0, 0, 0]);
  let depth = 1;
  for (let p = parent; p.parentId && nodes.has(p.parentId) && depth < 64; p = nodes.get(p.parentId)!) depth++;
  const r = shellRadius(depth);
  const candidates = Array.from({ length: 64 }, (_, i) =>
    keepOutOfCore(add(parent.position, scale(coneDirection(axis, i, 64, (depth === 1 ? 80 : 70) * (Math.PI / 180)), r))),
  );
  // Only nearby nodes matter for spacing.
  const radius2 = (r * 3) ** 2;
  const near = occupied.filter((o) => dist2(o, parent.position) < radius2);
  near.push(parent.position);
  return round(bestCandidate(candidates, near));
}

/**
 * Deterministic full re-layout of the whole network (user-invoked "redistribute").
 * Children are spread over an outward-facing cone around their parent; shell
 * radius grows with subtree size. A short repulsion pass resolves overlaps.
 */
export function computeFullLayout(snapshot: GraphSnapshot): Map<string, Vec3> {
  const nodes = snapshot.nodes;
  const childIndex = buildChildIndex(nodes);
  const result = new Map<string, Vec3>();
  const primaries = childIndex.get(null) ?? [];
  const subtreeSize = new Map<string, number>();
  for (const id of nodes.keys()) subtreeSize.set(id, getDescendantIds(nodes, id, childIndex).length);

  const primaryRadius = LAYOUT.primaryRadius + Math.min(5, Math.sqrt(nodes.size) * 0.14);
  primaries.forEach((id, i) => result.set(id, scale(fibonacciDirection(i, primaries.length), primaryRadius)));

  const queue: Array<{ id: string; depth: number; from: Vec3 }> = primaries.map((id) => ({ id, depth: 1, from: [0, 0, 0] }));
  while (queue.length) {
    const { id, depth, from } = queue.shift()!;
    const pos = result.get(id)!;
    const kids = childIndex.get(id) ?? [];
    if (!kids.length) continue;
    const axis = sub(pos, from);
    const spread = Math.min(Math.PI * 0.66, 0.7 + Math.sqrt(kids.length) * 0.15);
    kids.forEach((kid, i) => {
      const weight = 1 + Math.sqrt(subtreeSize.get(kid) ?? 0) * 0.16 + Math.sqrt(kids.length) * 0.1;
      const r = shellRadius(depth) * weight;
      result.set(kid, keepOutOfCore(add(pos, scale(coneDirection(axis, i, kids.length, spread), r))));
      queue.push({ id: kid, depth: depth + 1, from: pos });
    });
  }
  relax(result, 0.95, 6);
  for (const [id, p] of result) result.set(id, round(keepOutOfCore(p)));
  return result;
}

/** Spatial-hash repulsion so no two nodes sit closer than `minDist`. O(n) per iteration. */
function relax(positions: Map<string, Vec3>, minDist: number, iterations: number) {
  const ids = [...positions.keys()];
  const cell = minDist;
  for (let it = 0; it < iterations; it++) {
    const grid = new Map<string, string[]>();
    const key = (p: Vec3) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
    for (const id of ids) {
      const k = key(positions.get(id)!);
      let bucket = grid.get(k);
      if (!bucket) grid.set(k, (bucket = []));
      bucket.push(id);
    }
    let moved = false;
    for (const id of ids) {
      const p = positions.get(id)!;
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (other <= id) continue;
              const q = positions.get(other)!;
              const d = Math.sqrt(dist2(p, q));
              if (d >= minDist) continue;
              const dir = d < 1e-6 ? normalize([Math.sin(it + id.length), 0.3, Math.cos(it)]) : scale(sub(p, q), 1 / d);
              const push = (minDist - d) / 2;
              positions.set(id, add(p, scale(dir, push)));
              positions.set(other, sub(q, scale(dir, push)));
              moved = true;
            }
          }
    }
    if (!moved) break;
  }
}

/** Translate a node and its entire subtree by `delta` (used when the user drags a node). */
export function translateSubtree(nodes: ReadonlyMap<string, MindNode>, rootId: string, target: Vec3): Map<string, Vec3> {
  const root = nodes.get(rootId);
  const out = new Map<string, Vec3>();
  if (!root) return out;
  const delta = sub(keepOutOfCore(target), root.position);
  out.set(rootId, round(add(root.position, delta)));
  for (const id of getDescendantIds(nodes, rootId)) {
    const n = nodes.get(id)!;
    out.set(id, round(keepOutOfCore(add(n.position, delta))));
  }
  return out;
}

/**
 * Spatial migration for networks laid out around a smaller brain (earlier versions).
 * If any idea sits inside the current keep-out sphere, every idea is shifted radially
 * outward by the same distance — the deficit of the innermost idea — so the closest idea
 * lands exactly on the keep-out sphere. Directions, ordering and spacing between neighbouring
 * ideas are preserved; nothing is compressed. Works for layouts from any earlier version.
 * Returns only the nodes whose positions changed (empty when nothing needs migrating).
 */
export function migrateLayoutToCore(nodes: ReadonlyMap<string, MindNode>): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  let minR = Infinity;
  for (const n of nodes.values()) minR = Math.min(minR, len(n.position));
  if (!(minR < LAYOUT.coreRadius - 1e-3)) return out;
  const shift = LAYOUT.coreRadius - minR;
  for (const n of nodes.values()) {
    const r = len(n.position);
    out.set(n.id, round(scale(normalize(n.position), Math.max(LAYOUT.coreRadius, r + shift))));
  }
  return out;
}
