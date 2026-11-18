import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { sceneRuntime } from './runtime';

/**
 * Adaptive rendering for weak GPUs (e.g. TV sticks). Measures only during continuous
 * rendering (camera motion), so an idle demand-rendered scene never triggers changes.
 *
 * Every ~1.5 s of motion it compares the mean frame time with the budget:
 *   > 36 ms  → lower the pixel ratio (by 0.3 when very slow, else 0.15), down to 0.6
 *   < 20 ms  → raise it again (by 0.1) up to `max`, after a longer cooldown
 * If the pixel ratio is already at its floor and frames are still slow, `onDegrade`
 * switches the scene to the lighter material/geometry tier. The 3D scene is never removed.
 */
const MIN_DPR = 0.6;
const WINDOW_S = 1.5;

export function AdaptiveResolution({ max, onDegrade }: { max: number; onDegrade(): void }) {
  const { setDpr, viewport } = useThree();
  const acc = useRef({ sum: 0, count: 0 });
  const cooldownUntil = useRef(0);
  const degraded = useRef(false);
  useFrame((state, delta) => {
    sceneRuntime.dpr = viewport.dpr;
    if (delta > 0.5) {
      acc.current = { sum: 0, count: 0 }; // idle gap — not a performance signal
      return;
    }
    acc.current.sum += delta;
    acc.current.count++;
    if (acc.current.sum < WINDOW_S || acc.current.count < 5) return;
    const avgMs = (acc.current.sum / acc.current.count) * 1000;
    acc.current = { sum: 0, count: 0 };
    const now = state.clock.elapsedTime;
    if (now < cooldownUntil.current) return;
    const dpr = viewport.dpr;
    if (avgMs > 36) {
      if (dpr > MIN_DPR + 0.01) {
        setDpr(Math.max(MIN_DPR, +(dpr - (avgMs > 70 ? 0.3 : 0.15)).toFixed(2)));
        cooldownUntil.current = now + 0.8;
      } else if (avgMs > 45 && !degraded.current) {
        degraded.current = true;
        onDegrade();
        cooldownUntil.current = now + 2;
      }
    } else if (avgMs < 20 && dpr < max - 0.01) {
      setDpr(Math.min(max, +(dpr + 0.1).toFixed(2)));
      cooldownUntil.current = now + 4;
    }
  });
  return null;
}
