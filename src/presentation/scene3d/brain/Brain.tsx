import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshStandardMaterial, type Mesh } from 'three';
import { palette } from '@/design-system/tokens/palette';
import { getBrainGeometry } from './brainGeometry';

export const BRAIN_SCALE = 2.5;

interface BrainProps {
  /** Animate the neural pulse (ambient motion). */
  animate: boolean;
  /** 0..1 — dims the brain's glow while Focus Mode is active. */
  dim: number;
  quality: 'high' | 'low';
}

/**
 * Dark gunmetal sculpture. The standard PBR material is extended (onBeforeCompile) with:
 *  - cavity darkening + rougher surface inside sulci,
 *  - a restrained emissive "neural" glow travelling through the grooves (steel blue, rare gold synapses).
 */
export function Brain({ animate, dim, quality }: BrainProps) {
  const geometry = useMemo(() => getBrainGeometry(quality), [quality]);
  const mesh = useRef<Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uSteel: { value: new Color(palette.steelBright) },
      uGold: { value: new Color(palette.goldBright) },
    }),
    [],
  );

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: new Color('#71839a'), metalness: 0.82, roughness: 0.33, envMapIntensity: 1.9 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSulcus;\nvarying float vSulcus;\nvarying vec3 vObj;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSulcus = aSulcus;\nvObj = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime; uniform float uGlow; uniform vec3 uSteel; uniform vec3 uGold;
varying float vSulcus; varying vec3 vObj;
float omHash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }`,
        )
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.62 * vSulcus;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.8, vSulcus);')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
float wave = pow(0.5 + 0.5 * sin(uTime * 0.85 - vObj.z * 6.5 + vObj.y * 2.5 + sin(vObj.x * 9.0) * 0.6), 12.0);
float synapse = step(0.965, omHash(floor(vObj * 11.0)));
vec3 neural = mix(uSteel, uGold, synapse);
totalEmissiveRadiance += neural * vSulcus * vSulcus * (0.07 + 0.55 * wave) * uGlow;`,
        );
    };
    m.customProgramCacheKey = () => 'orbital-brain-v1';
    return m;
  }, [uniforms]);

  useFrame((_, delta) => {
    if (animate) uniforms.uTime.value += Math.min(delta, 0.1);
    uniforms.uGlow.value += (1 - dim * 0.65 - uniforms.uGlow.value) * Math.min(1, delta * 6);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} scale={BRAIN_SCALE} position={[0, 0.45, 0]} rotation={[0.1, -0.85, 0]} raycast={() => null} />;
}
