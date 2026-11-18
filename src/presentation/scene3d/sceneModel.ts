import type { GraphSnapshot } from '@/domain/entities/types';
import { buildAdjacency, getNeighborhood } from '@/domain/graph/neighborhood';
import { palette } from '@/design-system/tokens/palette';

/**
 * The scene's read model: a flat, GPU-friendly projection of the graph.
 * The 3D layer consumes ONLY this interface — never repositories or commands.
 */
export interface SceneGraph {
  ids: string[];
  index: Map<string, number>;
  titles: string[];
  /** xyz per node. Mutated in place while dragging (transient). */
  positions: Float32Array;
  /** Linear RGB per node. */
  colors: Float32Array;
  /** World radius per node. */
  sizes: Float32Array;
  depth: Uint16Array;
  /** 0 active, 1 completed, 2 archived */
  status: Uint8Array;
  /** Pairs (child, parent) of node indices. */
  hierarchy: Uint32Array;
  /** Pairs (a, b) of node indices for cross-connections. */
  cross: Uint32Array;
  adjacency: Map<string, Set<string>>;
  /** child index lists, for subtree drag. */
  children: number[][];
}

/** sRGB hex -> linear RGB (matches three's ColorManagement), without importing three into the main chunk. */
type RGB = [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function hexToLinear(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const STEEL = hexToLinear(palette.steelBright);
const DEEP = hexToLinear(palette.steel);
const DONE = hexToLinear(palette.verdigris);
const ARCH = lerp(hexToLinear(palette.gunmetal), hexToLinear(palette.steel), 0.35);

export function buildSceneGraph(s: GraphSnapshot): SceneGraph {
  const nodes = [...s.nodes.values()];
  const n = nodes.length;
  const ids = nodes.map((x) => x.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const depth = new Uint16Array(n);
  const status = new Uint8Array(n);
  const children: number[][] = Array.from({ length: n }, () => []);
  const hier: number[] = [];

  // Depth via memoised parent walk (0 doubles as "unset"; roots recompute trivially).
  const depthOf = (i: number, guard = 0): number => {
    if (depth[i] || guard > 256) return depth[i];
    const p = nodes[i].parentId;
    const pi = p ? index.get(p) : undefined;
    depth[i] = pi === undefined ? 0 : depthOf(pi, guard + 1) + 1;
    return depth[i];
  };
  for (let i = 0; i < n; i++) {
    const p = nodes[i].parentId;
    const pi = p ? index.get(p) : undefined;
    if (pi !== undefined) {
      hier.push(i, pi);
      children[pi].push(i);
    }
  }
  for (let i = 0; i < n; i++) depthOf(i);

  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    positions.set(node.position, i * 3);
    const d = depth[i];
    status[i] = node.status === 'completed' ? 1 : node.status === 'archived' ? 2 : 0;
    sizes[i] = d === 0 ? 0.66 : d === 1 ? 0.4 : Math.max(0.23, 0.3 - (d - 2) * 0.03);
    let c: RGB = node.color ? hexToLinear(node.color) : lerp(STEEL, DEEP, Math.min(1, d * 0.35));
    if (status[i] === 1) c = lerp(c, DONE, 0.65);
    if (status[i] === 2) c = ARCH;
    colors.set(c, i * 3);
  }

  const cross: number[] = [];
  for (const e of s.edges.values()) {
    const a = index.get(e.sourceNodeId);
    const b = index.get(e.targetNodeId);
    if (a !== undefined && b !== undefined) cross.push(a, b);
  }

  return {
    ids,
    index,
    titles: nodes.map((x) => x.title),
    positions,
    colors,
    sizes,
    depth,
    status,
    hierarchy: new Uint32Array(hier),
    cross: new Uint32Array(cross),
    adjacency: buildAdjacency(s),
    children,
  };
}

/**
 * Per-node emphasis targets in [0,1] (1 = fully lit, ~0.12 = dimmed) plus a
 * "selected" flag. Pure function of selection + focus — the scene animates toward it.
 */
export interface Emphasis {
  level: Float32Array;
  selected: Float32Array;
  /** Hop distance from the focus origin, or -1 if outside the focus set. */
  hops: Int8Array;
  focusActive: boolean;
}

export function computeEmphasis(g: SceneGraph, selectedId: string | null, focus: { active: boolean; level: 1 | 2 }, linkFromId: string | null): Emphasis {
  const n = g.ids.length;
  const level = new Float32Array(n).fill(1);
  const selected = new Float32Array(n);
  const hops = new Int8Array(n).fill(-1);
  const sel = selectedId ? g.index.get(selectedId) : undefined;
  if (sel !== undefined) selected[sel] = 1;
  const link = linkFromId ? g.index.get(linkFromId) : undefined;
  if (link !== undefined) selected[link] = 1;
  const active = focus.active && sel !== undefined;
  if (active) {
    const { distance } = getNeighborhood(g.adjacency, selectedId!, focus.level);
    level.fill(0.1);
    for (const [id, d] of distance) {
      const i = g.index.get(id);
      if (i === undefined) continue;
      hops[i] = d;
      level[i] = d === 0 ? 1 : d === 1 ? 0.95 : 0.62;
    }
  } else {
    for (let i = 0; i < n; i++) if (g.status[i] === 2) level[i] = 0.45;
  }
  return { level, selected, hops, focusActive: active };
}
