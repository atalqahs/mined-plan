import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Vector3, type PerspectiveCamera } from 'three';
import { getNeighborhood } from '@/domain/graph/neighborhood';
import { useUi } from '@/presentation/state/uiStore';
import type { SceneGraph } from '../sceneModel';
import { sceneRuntime } from '../runtime';

export const HOME = { position: new Vector3(0, 8, 40), target: new Vector3(0, 0, 0) };

/** Overview pose that fits the whole network (most of it, ignoring extreme outliers). */
function homePose(g: SceneGraph): Vector3 {
  const n = g.ids.length;
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(Math.hypot(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]));
  radii.sort((x, y) => x - y);
  const r = n ? radii[Math.floor((n - 1) * 0.9)] : 10;
  const dist = Math.min(78, Math.max(34, r * 2.35));
  return new Vector3(0, dist * 0.2, dist);
}

interface Props {
  graph: SceneGraph;
  reducedMotion: boolean;
  controlsRef: React.RefObject<CameraControls | null>;
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Owns the camera. Responds to camera requests (fly-to, focus framing, restore,
 * reset) issued through UI state, using damped transitions from camera-controls.
 */
export function CameraRig({ graph, reducedMotion, controlsRef }: Props) {
  const { camera, invalidate, size } = useThree();
  useEffect(() => {
    sceneRuntime.project = (p) => {
      const v = new Vector3(...p).project(camera);
      return v.z > 1 ? null : [(v.x * 0.5 + 0.5) * size.width, (-v.y * 0.5 + 0.5) * size.height];
    };
    return () => {
      sceneRuntime.project = null;
    };
  }, [camera, size]);
  const saved = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // Initial overview: fit the network once, when the first non-empty graph arrives.
  const fitted = useRef(false);
  useEffect(() => {
    const ctl = controlsRef.current;
    if (fitted.current || !ctl || graph.ids.length === 0) return;
    fitted.current = true;
    const p = homePose(graph);
    void ctl.setLookAt(p.x, p.y, p.z, 0, 0, 0, false);
  }, [graph, controlsRef]);

  useEffect(() => {
    let lastSeq = -1;
    const run = () => {
      const req = useUi.getState().cameraRequest;
      const ctl = controlsRef.current;
      if (!req || !ctl || req.seq === lastSeq) return;
      lastSeq = req.seq;
      const animate = !reducedMotion;
      const g = graphRef.current;
      const nodePos = (id: string) => {
        const i = g.index.get(id);
        return i === undefined ? null : new Vector3(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
      };
      switch (req.kind) {
        case 'reset': {
          saved.current = null;
          const h = homePose(g);
          void ctl.setLookAt(h.x, h.y, h.z, 0, 0, 0, animate);
          break;
        }
        case 'restore': {
          const s = saved.current;
          saved.current = null;
          if (s) void ctl.setLookAt(s.position.x, s.position.y, s.position.z, s.target.x, s.target.y, s.target.z, animate);
          break;
        }
        case 'fly': {
          const p = nodePos(req.nodeId);
          if (!p) break;
          // Approach from outside the orbit so the brain stays in view behind the idea.
          const dir = p.lengthSq() > 1e-6 ? p.clone().normalize() : new Vector3(0, 0, 1);
          const target = p.clone().multiplyScalar(0.55);
          const pos = p.clone().add(dir.multiplyScalar(9)).add(new Vector3(0, 2, 0));
          void ctl.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, animate);
          break;
        }
        case 'focus': {
          const p = nodePos(req.nodeId);
          if (!p) break;
          if (!saved.current) {
            ctl.getPosition(a);
            ctl.getTarget(b);
            saved.current = { position: a.clone(), target: b.clone() };
          }
          const level = useUi.getState().focus.level;
          const { distance } = getNeighborhood(g.adjacency, req.nodeId, level);
          // Weighted centre: the origin idea dominates; far cross-links shouldn't drag the view away.
          const center = p.clone().multiplyScalar(2);
          let weight = 2;
          const near: Vector3[] = [];
          for (const [id, hop] of distance) {
            if (hop === 0) continue;
            const q = nodePos(id);
            if (!q) continue;
            near.push(q);
            const w = hop === 1 ? 1 : 0.4;
            center.addScaledVector(q, w);
            weight += w;
          }
          center.divideScalar(weight);
          // Robust radius: frame the closest ~70% of related ideas; distant cross-links stay lit behind.
          const dists = near.map((q) => q.distanceTo(center)).sort((x, y) => x - y);
          const radius = Math.max(3, dists.length ? dists[Math.floor((dists.length - 1) * 0.7)] : 3);
          const fov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
          const dist = Math.min(30, Math.max(12, (radius / Math.tan(fov / 2)) * 1.1));
          // Three-quarter view from outside the orbit: the idea sits beside (not in front of) the brain,
          // which stays anchored in the background.
          const dir = (p.lengthSq() > 1 ? p.clone() : ctl.getPosition(c).clone()).normalize();
          dir.applyAxisAngle(UP, 0.62);
          dir.y += 0.28;
          dir.normalize();
          const pos = center.clone().add(dir.multiplyScalar(dist));
          void ctl.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, animate);
          break;
        }
      }
      invalidate();
    };
    run();
    return useUi.subscribe(run);
  }, [controlsRef, reducedMotion, camera, invalidate]);

  // Benchmark hook: continuous orbit to force rendering at full rate.
  useFrame((_, delta) => {
    if (sceneRuntime.autoOrbit && controlsRef.current) {
      controlsRef.current.azimuthAngle += sceneRuntime.autoOrbit * delta;
      invalidate();
    }
  });

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      minDistance={6}
      maxDistance={80}
      smoothTime={reducedMotion ? 0 : 0.42}
      draggingSmoothTime={reducedMotion ? 0 : 0.12}
      dollySpeed={0.6}
      azimuthRotateSpeed={0.55}
      polarRotateSpeed={0.55}
      truckSpeed={1.2}
    />
  );
}
