import { useMemo } from 'react';
import { ShaderMaterial } from 'three';

/**
 * Invisible-as-an-object grounding: a soft radial occlusion pool beneath the brain.
 * No geometry edge, no ornament — only a gentle darkening that gives the sculpture weight.
 */
export function Grounding() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {},
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, d)); gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * 0.55); }',
      }),
    [],
  );
  return (
    <mesh position={[0, -1.45, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material} raycast={() => null} renderOrder={-1}>
      <planeGeometry args={[7.5, 6, 1, 1]} />
    </mesh>
  );
}
