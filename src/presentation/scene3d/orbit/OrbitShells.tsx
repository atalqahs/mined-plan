import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { palette } from '@/design-system/tokens/palette';

/**
 * Faint great circles (a gimbal) at the primary orbit radius. They make the
 * spherical arrangement legible in 3D without competing with the ideas.
 */
export function OrbitShells({ radius, dim }: { radius: number; dim: number }) {
  const geometry = useMemo(() => {
    const pos: number[] = [];
    const seg = 192;
    const rings: Array<(t: number) => [number, number, number]> = [
      (t) => [Math.cos(t) * radius, 0, Math.sin(t) * radius],
      (t) => [Math.cos(t) * radius, Math.sin(t) * radius * 0.78, 0],
      (t) => [0, Math.sin(t) * radius * 0.78, Math.cos(t) * radius],
    ];
    for (const ring of rings) {
      for (let i = 0; i < seg; i++) {
        // dashed: draw 2 of every 3 segments
        if (i % 3 === 2) continue;
        pos.push(...ring((i / seg) * Math.PI * 2), ...ring(((i + 1) / seg) * Math.PI * 2));
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return g;
  }, [radius]);
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={palette.gunmetal} transparent opacity={0.42 * (1 - dim * 0.7)} depthWrite={false} />
    </lineSegments>
  );
}
