import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Vector3, type PerspectiveCamera } from 'three';
import { getNeighborhood } from '@/domain/graph/neighborhood';
import { useUi } from '@/presentation/state/uiStore';
import type { SceneGraph } from '../sceneModel';
import { sceneRuntime } from '../runtime';

export const HOME = { position: new Vector3(0, 8, 40), target: new Vector3(0, 0, 0) };

interface Props {
  graph: SceneGraph;
  reducedMotion: boolean;
  controlsRef: React.RefObject<CameraControls | null>;
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();

/**
 * Owns the camera. Responds to camera requests (fly-to, focus framing, restore,
 * reset) issued through UI state, using damped transitions from camera-controls.
 */
export function CameraRig({ graph, reducedMotion, controlsRef }: Props) {
  const { camera, invalidate } = useThree();
  const saved = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    camera.position.copy(HOME.position);
    camera.lookAt(HOME.target);
  }, [camera]);

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
        case 'reset':
          saved.current = null;
          void ctl.setLookAt(HOME.position.x, HOME.position.y, HOME.position.z, 0, 0, 0, animate);
          break;
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
          const center = new Vector3();
          let count = 0;
          for (const id of distance.keys()) {
            const q = nodePos(id);
            if (q) {
              center.add(q);
              count++;
            }
          }
          center.divideScalar(Math.max(1, count));
          // Keep the brain anchored: frame between the cluster and the core.
          center.lerp(new Vector3(0, 0, 0), 0.2);
          let radius = 2.5;
          for (const id of distance.keys()) {
            const q = nodePos(id);
            if (q) radius = Math.max(radius, q.distanceTo(center));
          }
          const fov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
          const dist = Math.min(48, (radius / Math.sin(fov / 2)) * 1.12 + 2);
          const dir = center.lengthSq() > 1 ? center.clone().normalize() : ctl.getPosition(c).clone().normalize();
          const pos = center.clone().add(dir.multiplyScalar(dist)).add(new Vector3(0, dist * 0.12, 0));
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
