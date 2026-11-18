import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';

/**
 * Shifts the projection centre horizontally (in CSS px) so the scene stays centred
 * in the area not covered by the details panel — without moving the camera itself.
 */
export function ViewOffset({ px, reducedMotion }: { px: number; reducedMotion: boolean }) {
  const { camera, size, invalidate } = useThree();
  const current = useRef(0);
  useEffect(() => invalidate(), [px, invalidate]);
  useFrame((_, delta) => {
    const cam = camera as PerspectiveCamera;
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 8);
    const next = Math.abs(px - current.current) < 0.5 ? px : current.current + (px - current.current) * k;
    const hasView = !!cam.view && cam.view.enabled;
    const sizeChanged = hasView && (cam.view!.fullWidth !== size.width || cam.view!.fullHeight !== size.height);
    const changed = next !== current.current || sizeChanged || (hasView && Math.abs(next) < 0.5);
    if (!changed) return;
    current.current = next;
    if (Math.abs(next) < 0.5) cam.clearViewOffset();
    else cam.setViewOffset(size.width, size.height, next, 0, size.width, size.height);
    cam.updateProjectionMatrix();
    if (next !== px) invalidate();
  });
  return null;
}
