import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Adaptive pixel ratio for weak GPUs (e.g. TV sticks). Only measures during continuous
 * rendering (camera motion), so an idle demand-rendered scene never triggers changes.
 * Steps the DPR down when frames exceed ~36 ms and back up when they fall under ~20 ms,
 * with a cooldown so it doesn't oscillate. The 3D scene itself is never simplified away.
 */
const MIN_DPR = 0.6;

export function AdaptiveResolution({ max }: { max: number }) {
  const { setDpr, viewport } = useThree();
  const samples = useRef<number[]>([]);
  const cooldownUntil = useRef(0);
  useFrame((state, delta) => {
    if (delta > 0.25) {
      samples.current = []; // idle gap — not a performance signal
      return;
    }
    samples.current.push(delta * 1000);
    if (samples.current.length < 45) return;
    const avg = samples.current.reduce((a, b) => a + b, 0) / samples.current.length;
    samples.current = [];
    const now = state.clock.elapsedTime;
    if (now < cooldownUntil.current) return;
    const dpr = viewport.dpr;
    if (avg > 36 && dpr > MIN_DPR + 0.01) {
      setDpr(Math.max(MIN_DPR, +(dpr - 0.15).toFixed(2)));
      cooldownUntil.current = now + 2;
    } else if (avg < 20 && dpr < max - 0.01) {
      setDpr(Math.min(max, +(dpr + 0.1).toFixed(2)));
      cooldownUntil.current = now + 4;
    }
  });
  return null;
}
