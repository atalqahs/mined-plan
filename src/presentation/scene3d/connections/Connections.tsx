import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineDashedMaterial } from 'three';
import { palette } from '@/design-system/tokens/palette';
import type { Emphasis, SceneGraph } from '../sceneModel';
import { sceneRuntime } from '../runtime';

const ARC_SEGMENTS = 14;
const HIER = new Color(palette.steel);
const HIER_CHILD = new Color(palette.gunmetal).lerp(new Color(palette.steel), 0.4);
const CROSS = new Color(palette.emphasis);

interface Props {
  graph: SceneGraph;
  emphasis: Emphasis;
  selectedIndex: number;
  reducedMotion: boolean;
}

/** Target brightness for an edge between node indices a and b. */
function edgeTarget(e: Emphasis, a: number, b: number, selected: number, base: number): number {
  if (e.focusActive) {
    const ha = e.hops[a], hb = e.hops[b];
    if (ha < 0 || hb < 0) return 0.035;
    return Math.min(ha, hb) === 0 ? 1 : 0.6;
  }
  if (a === selected || b === selected) return 1;
  return base * Math.min(e.level[a], e.level[b]);
}

export function Connections({ graph, emphasis, selectedIndex, reducedMotion }: Props) {
  const { invalidate } = useThree();
  const hierCount = graph.hierarchy.length / 2;
  const crossCount = graph.cross.length / 2;

  const hier = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(hierCount * 6), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(hierCount * 6), 3));
    return g;
  }, [hierCount]);

  const cross = useMemo(() => {
    const g = new BufferGeometry();
    const verts = crossCount * ARC_SEGMENTS * 2;
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute('lineDistance', new BufferAttribute(new Float32Array(verts), 1));
    return g;
  }, [crossCount]);

  useEffect(() => () => hier.dispose(), [hier]);
  useEffect(() => () => cross.dispose(), [cross]);

  const hierMat = useMemo(() => new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: true }), []);
  const crossMat = useMemo(() => new LineDashedMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, dashSize: 0.32, gapSize: 0.16, fog: true }), []);
  useEffect(
    () => () => {
      hierMat.dispose();
      crossMat.dispose();
    },
    [hierMat, crossMat],
  );

  const state = useRef({ hier: new Float32Array(0), cross: new Float32Array(0), posVersion: -1, force: true, graph: null as SceneGraph | null });

  useEffect(() => {
    state.current.hier = new Float32Array(hierCount).fill(0.5);
    state.current.cross = new Float32Array(crossCount).fill(0.6);
    state.current.posVersion = -1;
    state.current.force = true;
    state.current.graph = graph;
    invalidate();
  }, [graph, hierCount, crossCount, invalidate]);

  useFrame((_, delta) => {
    const s = state.current;
    if (s.graph !== graph) return;
    if (s.posVersion !== sceneRuntime.positionsVersion) {
      writeHierPositions(hier, graph);
      writeCrossPositions(cross, graph);
      s.posVersion = sceneRuntime.positionsVersion;
    }
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 9);
    let moving = false;
    // Density-aware base brightness: large graphs stay legible instead of turning into a web.
    const hierBase = Math.min(0.62, 14 / Math.sqrt(Math.max(1, hierCount)));
    const crossBase = Math.min(0.5, 2.8 / Math.sqrt(Math.max(1, crossCount)));

    const hc = hier.getAttribute('color') as BufferAttribute;
    const hcol = hc.array as Float32Array;
    let dirty = false;
    for (let i = 0; i < hierCount; i++) {
      const c = graph.hierarchy[i * 2], p = graph.hierarchy[i * 2 + 1];
      const t = edgeTarget(emphasis, c, p, selectedIndex, hierBase);
      const d = t - s.hier[i];
      if (d === 0 && !s.force) continue;
      s.hier[i] = Math.abs(d) < 0.003 ? t : s.hier[i] + d * k;
      if (Math.abs(d) >= 0.003) moving = true;
      const v = s.hier[i];
      const o = i * 6;
      hcol[o] = HIER.r * v; hcol[o + 1] = HIER.g * v; hcol[o + 2] = HIER.b * v;
      hcol[o + 3] = HIER_CHILD.r * v; hcol[o + 4] = HIER_CHILD.g * v; hcol[o + 5] = HIER_CHILD.b * v;
      dirty = true;
    }
    if (dirty) hc.needsUpdate = true;

    const cc = cross.getAttribute('color') as BufferAttribute;
    const ccol = cc.array as Float32Array;
    dirty = false;
    for (let i = 0; i < crossCount; i++) {
      const a = graph.cross[i * 2], b = graph.cross[i * 2 + 1];
      const t = edgeTarget(emphasis, a, b, selectedIndex, crossBase);
      const d = t - s.cross[i];
      if (d === 0 && !s.force) continue;
      s.cross[i] = Math.abs(d) < 0.003 ? t : s.cross[i] + d * k;
      if (Math.abs(d) >= 0.003) moving = true;
      const v = s.cross[i];
      const base = i * ARC_SEGMENTS * 6;
      for (let j = 0; j < ARC_SEGMENTS * 2; j++) {
        ccol[base + j * 3] = CROSS.r * v;
        ccol[base + j * 3 + 1] = CROSS.g * v;
        ccol[base + j * 3 + 2] = CROSS.b * v;
      }
      dirty = true;
    }
    if (dirty) cc.needsUpdate = true;
    s.force = false;
    if (moving) invalidate();
  });

  return (
    <group>
      {hierCount > 0 ? <lineSegments geometry={hier} material={hierMat} frustumCulled={false} raycast={() => null} /> : null}
      {crossCount > 0 ? <lineSegments geometry={cross} material={crossMat} frustumCulled={false} raycast={() => null} /> : null}
    </group>
  );
}

function writeHierPositions(geo: BufferGeometry, g: SceneGraph) {
  const attr = geo.getAttribute('position') as BufferAttribute;
  const a = attr.array as Float32Array;
  const P = g.positions;
  const n = g.hierarchy.length / 2;
  for (let i = 0; i < n; i++) {
    const c = g.hierarchy[i * 2] * 3, p = g.hierarchy[i * 2 + 1] * 3;
    a[i * 6] = P[p]; a[i * 6 + 1] = P[p + 1]; a[i * 6 + 2] = P[p + 2];
    a[i * 6 + 3] = P[c]; a[i * 6 + 4] = P[c + 1]; a[i * 6 + 5] = P[c + 2];
  }
  attr.needsUpdate = true;
  geo.computeBoundingSphere();
}

/** Quadratic arcs bowed away from the brain so cross-links never cut through the core. */
function writeCrossPositions(geo: BufferGeometry, g: SceneGraph) {
  const attr = geo.getAttribute('position') as BufferAttribute;
  const distAttr = geo.getAttribute('lineDistance') as BufferAttribute;
  const a = attr.array as Float32Array;
  const dist = distAttr.array as Float32Array;
  const P = g.positions;
  const n = g.cross.length / 2;
  const pts = new Float32Array((ARC_SEGMENTS + 1) * 3);
  for (let i = 0; i < n; i++) {
    const s = g.cross[i * 2] * 3, t = g.cross[i * 2 + 1] * 3;
    const ax = P[s], ay = P[s + 1], az = P[s + 2];
    const bx = P[t], by = P[t + 1], bz = P[t + 2];
    let mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    const span = Math.hypot(ax - bx, ay - by, az - bz);
    const ml = Math.hypot(mx, my, mz);
    const bow = span * 0.14 + 0.45;
    if (ml < 1e-3) my += bow;
    else {
      mx += (mx / ml) * bow;
      my += (my / ml) * bow;
      mz += (mz / ml) * bow;
    }
    for (let j = 0; j <= ARC_SEGMENTS; j++) {
      const u = j / ARC_SEGMENTS, w0 = (1 - u) ** 2, w1 = 2 * u * (1 - u), w2 = u * u;
      pts[j * 3] = w0 * ax + w1 * mx + w2 * bx;
      pts[j * 3 + 1] = w0 * ay + w1 * my + w2 * by;
      pts[j * 3 + 2] = w0 * az + w1 * mz + w2 * bz;
    }
    let acc = 0;
    const base = i * ARC_SEGMENTS * 2;
    for (let j = 0; j < ARC_SEGMENTS; j++) {
      const o = (base + j * 2) * 3;
      a[o] = pts[j * 3]; a[o + 1] = pts[j * 3 + 1]; a[o + 2] = pts[j * 3 + 2];
      a[o + 3] = pts[j * 3 + 3]; a[o + 4] = pts[j * 3 + 4]; a[o + 5] = pts[j * 3 + 5];
      const seg = Math.hypot(pts[j * 3 + 3] - pts[j * 3], pts[j * 3 + 4] - pts[j * 3 + 1], pts[j * 3 + 5] - pts[j * 3 + 2]);
      dist[base + j * 2] = acc;
      acc += seg;
      dist[base + j * 2 + 1] = acc;
    }
  }
  attr.needsUpdate = true;
  distAttr.needsUpdate = true;
  geo.computeBoundingSphere();
}
