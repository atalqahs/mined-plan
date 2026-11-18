import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import type { Group } from 'three';
import type { SceneGraph } from '../sceneModel';

/** Thin bevel-cut ring that marks the selected (ivory) or hovered (steel) idea. */
export function Halo({ graph, index, color, opacity = 0.9, scale = 1.75 }: { graph: SceneGraph; index: number; color: string; opacity?: number; scale?: number }) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g || index < 0 || index >= graph.ids.length) return;
    const P = graph.positions;
    g.position.set(P[index * 3], P[index * 3 + 1], P[index * 3 + 2]);
    const s = graph.sizes[index] * scale;
    g.scale.setScalar(s);
  });
  if (index < 0) return null;
  return (
    <group ref={group}>
      <Billboard>
        <mesh raycast={() => null}>
          <ringGeometry args={[1, 1.07, 6, 1]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh raycast={() => null} rotation={[0, 0, Math.PI / 6]} scale={1.22}>
          <ringGeometry args={[1, 1.025, 6, 1]} />
          <meshBasicMaterial color={color} transparent opacity={opacity * 0.35} depthWrite={false} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}
