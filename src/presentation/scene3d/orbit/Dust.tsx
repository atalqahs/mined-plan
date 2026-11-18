import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { palette } from '@/design-system/tokens/palette';

/** Sparse static motes for depth and atmosphere. One draw call, never animated. */
export function Dust({ count = 700 }: { count?: number }) {
  const geometry = useMemo(() => {
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pos: number[] = [];
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 30 + rnd() * 60;
      const q = Math.sqrt(1 - u * u);
      pos.push(Math.cos(th) * q * r, u * r * 0.7, Math.sin(th) * q * r);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return g;
  }, [count]);
  return (
    <points geometry={geometry} raycast={() => null}>
      <pointsMaterial color={palette.steel} size={1.4} sizeAttenuation={false} transparent opacity={0.45} depthWrite={false} fog={false} />
    </points>
  );
}
