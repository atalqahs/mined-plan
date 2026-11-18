import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Mesh } from 'three';
import { palette } from '@/design-system/tokens/palette';
import { getBrainGeometry } from './brainGeometry';

/** Brain world scale (1.6× the previous 5.0). Its surface reaches ≈ 7.4 units; LAYOUT.coreRadius (10.2) keeps a
 * clear "atmosphere" gap; primaries orbit at 12.6. */
export const BRAIN_SCALE = 8.0;

interface BrainProps {
  /** Animate the neural pulse (ambient motion). */
  animate: boolean;
  /** 0..1 — dims the brain's glow while Focus Mode is active. */
  dim: number;
  quality: 'high' | 'low';
}

/**
 * Dark polished-glass sculpture. A clear-coated physical material (crisp reflections of the
 * studio light strips) extended via onBeforeCompile with:
 *  - cavity darkening inside sulci (the clear coat stays glossy over them, like lacquered glass),
 *  - a fresnel rim that brightens toward the silhouette — the cue that reads as glass,
 *  - a faint inner "neural" light in the grooves that suggests depth / translucency.
 */
export function Brain({ animate, dim, quality }: BrainProps) {
  const geometry = useMemo(() => getBrainGeometry(quality), [quality]);
  const mesh = useRef<Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uSteel: { value: new Color(palette.steel) },
      uPale: { value: new Color(palette.ivory) },
      uRim: { value: new Color('#aeb4ba') },
    }),
    [],
  );

  const material = useMemo(() => {
    // High tier: true clear coat (a second, sharp reflection layer). Low tier (software rasterisers):
    // a single glossy layer approximating it — the clear coat doubles per-pixel shading cost there.
    const m =
      quality === 'high'
        ? new MeshPhysicalMaterial({
            color: new Color('#43484f'),
            metalness: 0.2,
            roughness: 0.36,
            clearcoat: 1,
            clearcoatRoughness: 0.12,
            ior: 1.5,
            specularIntensity: 1,
            envMapIntensity: 1.5,
          })
        : new MeshStandardMaterial({ color: new Color('#43484f'), metalness: 0.3, roughness: 0.2, envMapIntensity: 1.6 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSulcus;\nvarying float vSulcus;\nvarying vec3 vObj;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSulcus = aSulcus;\nvObj = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime; uniform float uGlow; uniform vec3 uSteel; uniform vec3 uPale; uniform vec3 uRim;
varying float vSulcus; varying vec3 vObj;
float omHash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }`,
        )
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.75 * vSulcus;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, vSulcus);')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
float wave = pow(0.5 + 0.5 * sin(uTime * 0.85 - vObj.z * 6.5 + vObj.y * 2.5 + sin(vObj.x * 9.0) * 0.6), 12.0);
float synapse = step(0.965, omHash(floor(vObj * 11.0)));
vec3 neural = mix(uSteel, uPale, synapse * 0.6);
totalEmissiveRadiance += neural * vSulcus * vSulcus * (0.05 + 0.32 * wave) * uGlow;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `float omFres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
outgoingLight += uRim * omFres * (0.32 - 0.18 * vSulcus) * (0.55 + 0.45 * uGlow);
#include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => `orbital-brain-v3-${quality}`;
    return m;
  }, [uniforms, quality]);

  useFrame((_, delta) => {
    if (animate) uniforms.uTime.value += Math.min(delta, 0.1);
    uniforms.uGlow.value += (1 - dim * 0.65 - uniforms.uGlow.value) * Math.min(1, delta * 6);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} scale={BRAIN_SCALE} rotation={[0.1, -0.85, 0]} raycast={() => null} />;
}
