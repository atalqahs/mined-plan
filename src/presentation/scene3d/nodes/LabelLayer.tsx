import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Matrix4, Vector3, type PerspectiveCamera } from 'three';
import type { Emphasis, SceneGraph } from '../sceneModel';
import { sceneRuntime } from '../runtime';
import type { LabelDensity } from '@/presentation/state/uiStore';

const BUDGET: Record<LabelDensity, number> = { low: 16, balanced: 44, high: 110 };
/** Sphere approximating the brain for label occlusion (its surface reaches ≈ 4.6 units). */
const BRAIN_OCCLUDER_RADIUS = 4.1;

/** True when the brain sits between the camera C and the point P (segment passes through the occluder sphere). */
function behindBrain(cx: number, cy: number, cz: number, px: number, py: number, pz: number): boolean {
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-6) return false;
  const t = Math.max(0, Math.min(1, -(cx * dx + cy * dy + cz * dz) / len2));
  if (t >= 0.999) return false;
  const qx = cx + dx * t, qy = cy + dy * t, qz = cz + dz * t;
  return qx * qx + qy * qy + qz * qz < BRAIN_OCCLUDER_RADIUS * BRAIN_OCCLUDER_RADIUS;
}
const v = new Vector3();
const viewProj = new Matrix4();
const lastMatrix = new Matrix4();

interface Props {
  graph: SceneGraph;
  emphasis: Emphasis;
  selectedIndex: number;
  hoveredIndex: number;
  density: LabelDensity;
}

interface Candidate {
  i: number;
  x: number;
  y: number;
  depth: number;
  score: number;
  scale: number;
  w: number;
}

/**
 * Arabic labels are rendered as real DOM text (perfect shaping + bidi) in a
 * pooled overlay. Every node stays in the 3D scene; only *labels* are culled by
 * priority, distance and screen-space collisions so the network stays legible.
 */
export function LabelLayer({ graph, emphasis, selectedIndex, hoveredIndex, density }: Props) {
  const { camera, size } = useThree();
  const pool = useRef<HTMLDivElement[]>([]);
  const assigned = useRef<Int32Array>(new Int32Array(0));
  const dirty = useRef(true);

  useEffect(() => {
    dirty.current = true;
  }, [graph, emphasis, selectedIndex, hoveredIndex, density, size.width, size.height]);

  useEffect(
    () => () => {
      for (const el of pool.current) el.remove();
      pool.current = [];
    },
    [],
  );

  const lastPos = useRef(-1);

  useFrame(() => {
    const host = sceneRuntime.labelHost;
    if (!host) return;
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!dirty.current && viewProj.equals(lastMatrix) && lastPos.current === sceneRuntime.positionsVersion) return;
    lastMatrix.copy(viewProj);
    lastPos.current = sceneRuntime.positionsVersion;
    dirty.current = false;

    const n = graph.ids.length;
    const W = size.width, H = size.height;
    const focal = H / 2 / Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360);
    const P = graph.positions;
    const cands: Candidate[] = [];
    const cam = camera.position;
    for (let i = 0; i < n; i++) {
      const focusHop = emphasis.hops[i];
      if (emphasis.focusActive && focusHop < 0 && i !== hoveredIndex) continue;
      // Ideas hidden behind the brain keep their 3D orb (depth-tested) but not their label.
      if (i !== selectedIndex && i !== hoveredIndex && behindBrain(cam.x, cam.y, cam.z, P[i * 3], P[i * 3 + 1], P[i * 3 + 2])) continue;
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      if (depth <= 0.5) continue;
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(viewProj);
      if (v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
      const d = graph.depth[i];
      let score = d === 0 ? 4 : d === 1 ? 2 : 1 - Math.min(0.6, d * 0.1);
      if (i === selectedIndex) score += 40;
      if (i === hoveredIndex) score += 30;
      if (emphasis.focusActive) score += focusHop === 0 ? 30 : focusHop === 1 ? 14 : 6;
      score -= depth * 0.09;
      const scale = Math.max(0.78, Math.min(1.12, 22 / depth + 0.25));
      const screenR = (graph.sizes[i] * focal) / depth;
      const w = Math.min(240, graph.titles[i].length * 7.4 * scale + 18);
      cands.push({ i, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H + screenR + 6, depth, score, scale, w });
    }
    cands.sort((a, b) => b.score - a.score);

    const budget = BUDGET[density] + (emphasis.focusActive ? 30 : 0);
    const accepted: Candidate[] = [];
    for (const c of cands) {
      if (accepted.length >= budget) break;
      const mustShow = c.i === selectedIndex || c.i === hoveredIndex;
      const h = 22 * c.scale;
      let overlap = false;
      if (!mustShow) {
        for (const a of accepted) {
          if (Math.abs(a.x - c.x) * 2 < (a.w + c.w) * 0.92 && Math.abs(a.y - c.y) < (h + 22 * a.scale) * 0.5) {
            overlap = true;
            break;
          }
        }
      }
      if (!overlap) accepted.push(c);
    }

    // Grow the pool lazily.
    while (pool.current.length < accepted.length) {
      const el = document.createElement('div');
      el.className = 'om-label';
      el.dir = 'auto';
      host.appendChild(el);
      pool.current.push(el);
    }
    if (assigned.current.length < pool.current.length) {
      const next = new Int32Array(pool.current.length).fill(-1);
      next.set(assigned.current);
      assigned.current = next;
    }

    for (let k = 0; k < pool.current.length; k++) {
      const el = pool.current[k];
      const c = accepted[k];
      if (!c) {
        if (assigned.current[k] !== -1) {
          el.style.display = 'none';
          assigned.current[k] = -1;
        }
        continue;
      }
      if (assigned.current[k] !== c.i || el.textContent !== graph.titles[c.i]) {
        el.textContent = graph.titles[c.i];
        assigned.current[k] = c.i;
      }
      const kind = c.i === selectedIndex ? 'selected' : graph.depth[c.i] === 0 ? 'primary' : 'secondary';
      if (el.dataset.kind !== kind) el.dataset.kind = kind;
      const fade = Math.max(0.35, Math.min(1, 1.25 - c.depth / 55));
      const dimmed = emphasis.focusActive && emphasis.hops[c.i] === 2 ? 0.7 : 1;
      el.style.display = '';
      el.style.opacity = String(fade * dimmed);
      el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) translateX(-50%) scale(${c.scale.toFixed(3)})`;
    }
  });

  return null;
}
