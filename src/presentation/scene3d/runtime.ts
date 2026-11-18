/**
 * Mutable, non-React runtime shared by scene components for high-frequency
 * work (drag positions, frame statistics, label container). Kept out of React
 * state on purpose: writing here never triggers a re-render.
 */
export interface SceneRuntime {
  /** Bumped whenever SceneGraph.positions are mutated in place (drag). */
  positionsVersion: number;
  dragging: boolean;
  labelHost: HTMLDivElement | null;
  frameTimes: Float32Array;
  frameCursor: number;
  frames: number;
  /** Benchmark hook: rotate the camera continuously. */
  autoOrbit: number;
  /** What the scene currently renders (for tests / diagnostics). */
  rendered: { nodes: number; hierarchyLinks: number; crossLinks: number };
  /** Projects a world point to canvas CSS pixels (set by the camera rig; used by tests). */
  project: ((p: [number, number, number]) => [number, number] | null) | null;
}

export const sceneRuntime: SceneRuntime = {
  positionsVersion: 0,
  dragging: false,
  labelHost: null,
  frameTimes: new Float32Array(600),
  frameCursor: 0,
  frames: 0,
  autoOrbit: 0,
  rendered: { nodes: 0, hierarchyLinks: 0, crossLinks: 0 },
  project: null,
};

export function recordFrame(deltaSeconds: number) {
  const r = sceneRuntime;
  r.frameTimes[r.frameCursor] = deltaSeconds * 1000;
  r.frameCursor = (r.frameCursor + 1) % r.frameTimes.length;
  r.frames++;
}

export function frameStats() {
  const r = sceneRuntime;
  const count = Math.min(r.frames, r.frameTimes.length);
  const arr = Array.from(r.frameTimes.slice(0, count)).filter((x) => x > 0 && x < 1000).sort((a, b) => a - b);
  if (!arr.length) return null;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { samples: arr.length, avgMs: avg, fps: 1000 / avg, p50Ms: arr[Math.floor(arr.length * 0.5)], p95Ms: arr[Math.floor(arr.length * 0.95)], maxMs: arr[arr.length - 1] };
}

export function resetFrameStats() {
  sceneRuntime.frameTimes.fill(0);
  sceneRuntime.frameCursor = 0;
  sceneRuntime.frames = 0;
}
