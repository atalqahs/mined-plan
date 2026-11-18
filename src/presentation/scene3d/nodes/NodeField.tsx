import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Color, IcosahedronGeometry, InstancedBufferAttribute, Matrix4, Plane, ShaderMaterial, Vector3, type InstancedMesh } from 'three';
import { palette } from '@/design-system/tokens/palette';
import type { Emphasis, SceneGraph } from '../sceneModel';
import { sceneRuntime } from '../runtime';

interface NodeFieldProps {
  graph: SceneGraph;
  emphasis: Emphasis;
  hoveredIndex: number;
  reducedMotion: boolean;
  quality: 'high' | 'low';
  onHover(index: number | null): void;
  onSelect(index: number, event: { double: boolean }): void;
  onDragEnd(index: number, position: [number, number, number]): void;
  setControlsEnabled(enabled: boolean): void;
}

const vertex = /* glsl */ `
attribute vec3 aColor;
attribute float aEmph;
attribute float aSel;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vEmph;
varying float vSel;
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  vColor = aColor;
  vEmph = aEmph;
  vSel = aSel;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
uniform vec3 uSel;
uniform vec3 uBg;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vEmph;
varying float vSel;
varying float vDepth;
void main() {
  vec3 n = normalize(vN);
  float ndv = clamp(dot(n, vV), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.3);
  vec3 L = normalize(vec3(0.35, 0.75, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vV), 0.0, 1.0), 18.0);
  vec3 base = mix(vColor, uSel, vSel);
  vec3 col = base * 0.06 + base * diff * 0.26 + base * fres * 0.95 + vec3(spec) * 0.16;
  col += base * vSel * (0.35 + 0.6 * fres);
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  float vis = mix(0.1, 1.0, vEmph);
  col = mix(uBg, col, clamp(vis * (1.0 - fog * 0.7), 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const m4 = new Matrix4();
const v3 = new Vector3();
const plane = new Plane();
const hit = new Vector3();
const camDir = new Vector3();

/**
 * All ideas in ONE instanced draw call. Per-instance attributes (colour,
 * emphasis, selection) are eased toward their targets inside useFrame; React
 * state is never touched per frame.
 */
export function NodeField({ graph, emphasis, hoveredIndex, reducedMotion, quality, onHover, onSelect, onDragEnd, setControlsEnabled }: NodeFieldProps) {
  const count = graph.ids.length;
  const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
  const mesh = useRef<InstancedMesh>(null);
  const { camera, raycaster, invalidate, gl } = useThree();

  const geometry = useMemo(() => {
    // 320 triangles (high) / 80 (low) per idea: orbs are small on screen, shading is per-pixel.
    const g = new IcosahedronGeometry(1, quality === 'high' ? 2 : 1);
    g.setAttribute('aColor', new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    g.setAttribute('aEmph', new InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1));
    g.setAttribute('aSel', new InstancedBufferAttribute(new Float32Array(capacity), 1));
    return g;
  }, [capacity, quality]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uSel: { value: new Color(palette.emphasisBright) },
          uBg: { value: new Color(palette.obsidian) },
          uFogNear: { value: 34 },
          uFogFar: { value: 90 },
        },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // Current (animated) emphasis values persist across graph rebuilds by id.
  const current = useRef<{ ids: string[]; emph: Float32Array; sel: Float32Array }>({ ids: [], emph: new Float32Array(0), sel: new Float32Array(0) });
  const lastPositionsVersion = useRef(-1);

  // Rebuild static instance data when the graph changes.
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const prev = current.current;
    const prevIndex = new Map(prev.ids.map((id, i) => [id, i]));
    const emph = new Float32Array(count).fill(1);
    const sel = new Float32Array(count);
    graph.ids.forEach((id, i) => {
      const j = prevIndex.get(id);
      if (j !== undefined) {
        emph[i] = prev.emph[j];
        sel[i] = prev.sel[j];
      }
    });
    current.current = { ids: graph.ids, emph, sel };
    (geometry.getAttribute('aColor') as InstancedBufferAttribute).array.set(graph.colors);
    geometry.getAttribute('aColor').needsUpdate = true;
    // count must be set BEFORE the bounds are computed, or raycasting sees an empty sphere.
    m.count = count;
    writeMatrices(m, graph);
    lastPositionsVersion.current = sceneRuntime.positionsVersion;
    invalidate();
  }, [graph, geometry, count, invalidate]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    if (lastPositionsVersion.current !== sceneRuntime.positionsVersion) {
      writeMatrices(m, graph);
      lastPositionsVersion.current = sceneRuntime.positionsVersion;
    }
    const cur = current.current;
    if (cur.emph.length !== count) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 9);
    const aE = geometry.getAttribute('aEmph') as InstancedBufferAttribute;
    const aS = geometry.getAttribute('aSel') as InstancedBufferAttribute;
    let moving = false;
    for (let i = 0; i < count; i++) {
      const tE = Math.min(1, emphasis.level[i] + (i === hoveredIndex ? 0.35 : 0));
      const tS = emphasis.selected[i];
      const dE = tE - cur.emph[i];
      const dS = tS - cur.sel[i];
      if (dE !== 0 || dS !== 0) {
        if (Math.abs(dE) < 0.002 && Math.abs(dS) < 0.002) {
          cur.emph[i] = tE;
          cur.sel[i] = tS;
        } else {
          cur.emph[i] += dE * k;
          cur.sel[i] += dS * k;
          moving = true;
        }
        (aE.array as Float32Array)[i] = cur.emph[i];
        (aS.array as Float32Array)[i] = cur.sel[i];
        aE.needsUpdate = true;
        aS.needsUpdate = true;
      }
    }
    if (moving) invalidate();
  });

  // ---- Interaction: click / double-click / drag (with a travel threshold) ----
  const drag = useRef<{ index: number; startX: number; startY: number; active: boolean; offset: Vector3; origin: Float32Array; subtree: number[] } | null>(null);

  const subtreeOf = (root: number) => {
    const out = [root];
    for (let i = 0; i < out.length; i++) for (const c of graph.children[out[i]]) out.push(c);
    return out;
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || e.instanceId === undefined) return;
    e.stopPropagation();
    const index = e.instanceId;
    setControlsEnabled(false);
    // R3F pointer capture: subsequent move/up events route to this mesh even off-target.
    (e.target as unknown as { setPointerCapture?: (id: number) => void })?.setPointerCapture?.(e.pointerId);
    const p = graph.positions;
    v3.set(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
    camera.getWorldDirection(camDir);
    plane.setFromNormalAndCoplanarPoint(camDir, v3);
    raycaster.ray.intersectPlane(plane, hit);
    const subtree = subtreeOf(index);
    const origin = new Float32Array(subtree.length * 3);
    subtree.forEach((n, i) => origin.set(p.subarray(n * 3, n * 3 + 3), i * 3));
    drag.current = { index, startX: e.clientX, startY: e.clientY, active: false, offset: v3.clone().sub(hit), origin, subtree };
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (d) {
      if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) {
        d.active = true;
        sceneRuntime.dragging = true;
        gl.domElement.style.cursor = 'grabbing';
      }
      if (d.active && raycaster.ray.intersectPlane(plane, hit)) {
        const target = hit.add(d.offset);
        const ox = target.x - d.origin[0], oy = target.y - d.origin[1], oz = target.z - d.origin[2];
        const p = graph.positions;
        d.subtree.forEach((n, i) => {
          p[n * 3] = d.origin[i * 3] + ox;
          p[n * 3 + 1] = d.origin[i * 3 + 1] + oy;
          p[n * 3 + 2] = d.origin[i * 3 + 2] + oz;
        });
        sceneRuntime.positionsVersion++;
        invalidate();
      }
      return;
    }
    if (e.instanceId !== undefined) {
      e.stopPropagation();
      if (e.instanceId !== hoveredIndex) onHover(e.instanceId);
    }
  };

  const lastClick = useRef({ index: -1, time: 0 });
  const finish = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    drag.current = null;
    setControlsEnabled(true);
    gl.domElement.style.cursor = '';
    sceneRuntime.dragging = false;
    if (!d) return;
    e.stopPropagation();
    if (d.active) {
      const p = graph.positions;
      onDragEnd(d.index, [p[d.index * 3], p[d.index * 3 + 1], p[d.index * 3 + 2]]);
      return;
    }
    const now = performance.now();
    const double = lastClick.current.index === d.index && now - lastClick.current.time < 350;
    lastClick.current = { index: d.index, time: now };
    onSelect(d.index, { double });
  };

  return (
    <instancedMesh
      key={`${capacity}-${quality}`}
      ref={mesh}
      args={[geometry, material, capacity]}
      frustumCulled={false}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerOut={() => {
        if (!drag.current) onHover(null);
      }}
    />
  );
}

function writeMatrices(m: InstancedMesh, g: SceneGraph) {
  const n = g.ids.length;
  for (let i = 0; i < n; i++) {
    const s = g.sizes[i];
    m4.makeScale(s, s, s).setPosition(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
    m.setMatrixAt(i, m4);
  }
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
}
