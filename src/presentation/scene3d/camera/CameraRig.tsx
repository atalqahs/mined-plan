import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Vector3, type PerspectiveCamera } from 'three';
import { getNeighborhood } from '@/domain/graph/neighborhood';
import { useUi } from '@/presentation/state/uiStore';
import type { SceneGraph } from '../sceneModel';
import { sceneRuntime } from '../runtime';

/**
 * Camera composition profile. Each display gets its own framing instead of one
 * camera for all: a 16:9 TV, a narrow phone and the spacious desktop workspace.
 */
export type ViewProfile = 'desktop' | 'mobile' | 'tv';

/** Brain surface radius in world units (BRAIN_SCALE × ≈0.93). */
const BRAIN_RADIUS = 7.4;

/** How much of the network each profile fits on screen (fraction of the 90th-percentile radius). */
const FIT: Record<ViewProfile, number> = { desktop: 0.86, mobile: 0.8, tv: 0.8 };

/**
 * Overview pose. Fits the network inside the *narrower* field of view (vertical on
 * landscape, horizontal on portrait), so the same scene composes correctly on a
 * 16:9 television, a portrait phone and a desktop window, without distortion.
 */
export function homePose(g: SceneGraph, profile: ViewProfile, aspect: number, fovDeg: number): Vector3 {
  const n = g.ids.length;
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(Math.hypot(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]));
  radii.sort((x, y) => x - y);
  // An empty network frames the brain alone, generously, as the centrepiece.
  const fitRadius = n ? Math.max(BRAIN_RADIUS * 1.9, radii[Math.floor((n - 1) * 0.9)] * FIT[profile]) : BRAIN_RADIUS * 1.55;
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.2, aspect));
  const dist = Math.min(170, (fitRadius / Math.tan(Math.min(vHalf, hHalf))) * 1.04);
  // A slightly elevated, cinematic angle (a little lower on TV so the brain reads as a floating planet).
  const elevation = profile === 'tv' ? 0.14 : 0.2;
  return new Vector3(0, dist * elevation, dist);
}

interface Props {
  graph: SceneGraph;
  reducedMotion: boolean;
  controlsRef: React.RefObject<CameraControls | null>;
  profile: ViewProfile;
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Owns the camera. Responds to camera requests (fly-to, focus framing, restore,
 * reset) issued through UI state, using damped transitions from camera-controls.
 */
export function CameraRig({ graph, reducedMotion, controlsRef, profile }: Props) {
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
  const frame = useRef({ profile, aspect: size.width / Math.max(1, size.height) });
  frame.current = { profile, aspect: size.width / Math.max(1, size.height) };
  const home = () => homePose(graphRef.current, frame.current.profile, frame.current.aspect, (camera as PerspectiveCamera).fov);

  // Imperative camera API for remote controllers (phone companion, TV remote keys).
  useEffect(() => {
    sceneRuntime.camera = {
      rotate: (azimuth, polar) => {
        const ctl = controlsRef.current;
        if (!ctl) return;
        void ctl.rotate(azimuth, polar, true);
        invalidate();
      },
      zoom: (factor) => {
        const ctl = controlsRef.current;
        if (!ctl) return;
        void ctl.dollyTo(Math.min(ctl.maxDistance, Math.max(ctl.minDistance, ctl.distance / factor)), true);
        invalidate();
      },
      reset: () => {
        const ctl = controlsRef.current;
        if (!ctl) return;
        saved.current = null;
        const h = home();
        void ctl.setLookAt(h.x, h.y, h.z, 0, 0, 0, !reducedMotion);
        invalidate();
      },
      pose: () => {
        const ctl = controlsRef.current;
        if (!ctl) return null;
        const p = ctl.getPosition(new Vector3());
        return { position: [p.x, p.y, p.z], distance: ctl.distance, azimuth: ctl.azimuthAngle, polar: ctl.polarAngle };
      },
    };
    return () => {
      sceneRuntime.camera = null;
    };
  }, [controlsRef, invalidate, reducedMotion]);

  // Re-frame when the display profile changes (e.g. entering TV mode).
  const lastProfile = useRef(profile);
  useEffect(() => {
    if (lastProfile.current === profile) return;
    lastProfile.current = profile;
    const ctl = controlsRef.current;
    if (!ctl || graphRef.current.ids.length === 0) return;
    const h = home();
    void ctl.setLookAt(h.x, h.y, h.z, 0, 0, 0, false);
    invalidate();
  }, [profile]);

  // Initial overview: frame the brain alone while the network is empty, then fit once more
  // when the first ideas arrive (e.g. a phone sharing its graph with the TV).
  const fitted = useRef<'none' | 'empty' | 'graph'>('none');
  useEffect(() => {
    const ctl = controlsRef.current;
    const kind = graph.ids.length === 0 ? 'empty' : 'graph';
    if (!ctl || fitted.current === 'graph' || fitted.current === kind) return;
    fitted.current = kind;
    const p = home();
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
          const h = home();
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
          const pos = p.clone().add(dir.multiplyScalar(18)).add(new Vector3(0, 4, 0));
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
          const dist = Math.min(55, Math.max(21, (radius / Math.tan(fov / 2)) * 1.1));
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
      minDistance={14}
      maxDistance={170}
      smoothTime={reducedMotion ? 0 : 0.42}
      draggingSmoothTime={reducedMotion ? 0 : 0.12}
      dollySpeed={0.6}
      azimuthRotateSpeed={0.55}
      polarRotateSpeed={0.55}
      truckSpeed={1.2}
    />
  );
}
