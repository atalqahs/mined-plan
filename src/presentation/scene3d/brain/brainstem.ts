import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from 'three';
import { createNoise3D } from './noise';

/**
 * Organic brainstem + upper spinal cord.
 *
 * A tube swept along a gently curving centreline (descending and leaning slightly
 * backward, in front of the cerebellum). Its cross-section is not a circle: radius,
 * width/depth ratio and surface relief change continuously along the length:
 *
 *   t 0.00–0.30  pons      broad, laterally wide, rounded front with faint transverse fibres
 *   t 0.30–0.58  medulla   two anterior pyramids beside the median fissure, olive bulges on the flanks
 *   t 0.58–1.00  cord      slightly oval, anterior median fissure + posterior median sulcus,
 *                          two very subtle lateral vessels; tapers into a rounded closed tip
 *
 * The top of the tube starts inside the hemispheres/cerebellum mass so the junction is
 * hidden and the stem reads as growing out of the brain, not attached to it.
 * Output attributes match the brain: position, normal, aSulcus (groove depth 0..1).
 */
const RINGS = 140;
const SEGMENTS = 56;

const gauss = (x: number, w: number) => Math.exp(-((x / w) ** 2));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Shortest signed angle difference. */
const dAng = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function brainstemGeometry(): BufferGeometry {
  const noise = createNoise3D(23);
  // Centreline in brain object space (y up, +z front). Starts buried in the brain base.
  const curve = new CatmullRomCurve3(
    // Gentle S-curve: the pons emerges under the temporal lobes, the cord leans back then straightens.
    [new Vector3(0, -0.3, 0.02), new Vector3(0, -0.52, -0.02), new Vector3(0.004, -0.74, -0.12), new Vector3(0.01, -0.96, -0.22), new Vector3(0.012, -1.16, -0.25), new Vector3(0.008, -1.32, -0.24)],
    false,
    'centripetal',
  );

  const positions = new Float32Array((RINGS + 1) * (SEGMENTS + 1) * 3);
  const sulcus = new Float32Array((RINGS + 1) * (SEGMENTS + 1));
  const lateral = new Vector3(1, 0, 0);
  const front = new Vector3();
  const tangent = new Vector3();
  const p = new Vector3();

  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tangent);
    // Curve lies (almost) in the YZ plane, so world X stays perpendicular to the tangent.
    front.crossVectors(lateral, tangent).normalize().negate();

    // Base radius profile: pons bulge → medulla → cord, then a rounded closed tip.
    const pons = gauss(t - 0.2, 0.12);
    let R = 0.062 + 0.105 * pons + 0.032 * gauss(t - 0.45, 0.1) - 0.012 * smooth(0.6, 0.95, t);
    if (t > 0.93) R *= Math.sqrt(Math.max(0, 1 - ((t - 0.93) / 0.07) ** 2));
    if (t < 0.03) R *= 0.6 + 0.4 * (t / 0.03); // buried top: closes inside the brain
    const widthX = 1 + 0.42 * pons + 0.16 * smooth(0.58, 0.78, t); // pons wide; cord slightly oval
    const depthZ = 1 + 0.12 * pons - 0.08 * smooth(0.55, 0.75, t);

    const medulla = smooth(0.3, 0.4, t) * (1 - smooth(0.56, 0.66, t));
    const cord = smooth(0.56, 0.68, t);

    for (let j = 0; j <= SEGMENTS; j++) {
      const th = (j / SEGMENTS) * Math.PI * 2; // 0 = front, π/2 = lateral (+x)
      let relief = 0;
      let groove = 0;

      // Anterior median fissure (medulla → cord), posterior median sulcus (cord).
      const fissure = gauss(dAng(th, 0), 0.075) * (0.35 * medulla + 0.55 * cord + 0.15 * pons);
      const posterior = gauss(dAng(th, Math.PI), 0.07) * 0.4 * cord;
      relief -= 0.2 * fissure + 0.12 * posterior;
      groove = Math.max(groove, fissure, posterior * 0.8);

      // Pyramids: two soft longitudinal ridges either side of the fissure.
      relief += 0.13 * medulla * (gauss(dAng(th, 0.32), 0.18) + gauss(dAng(th, -0.32), 0.18));
      // Olives: oval bulges on the flanks of the medulla.
      const olive = gauss(t - 0.47, 0.055) * (gauss(dAng(th, 1.15), 0.3) + gauss(dAng(th, -1.15), 0.3));
      relief += 0.2 * olive;
      // Pons: faint transverse fibres across its front.
      relief += 0.03 * pons * Math.sin(t * 140) * gauss(dAng(th, 0), 1.1);
      // Gentle longitudinal ridges along the cord.
      relief += 0.022 * cord * Math.sin(th * 6 + 0.4) + 0.02 * cord * Math.sin(t * 38 + th * 2);
      // Two very subtle lateral vessels winding slowly down the cord.
      for (const side of [1, -1]) {
        const vth = side * (1.72 + 0.16 * Math.sin(t * 11 + side));
        relief += 0.04 * (cord + 0.5 * medulla) * gauss(dAng(th, vth), 0.05);
      }
      // Fine organic surface variation and slight asymmetry.
      relief += 0.035 * noise(Math.cos(th) * 1.4, t * 7, Math.sin(th) * 1.4 + 3);

      const r = R * (1 + relief);
      const lx = Math.sin(th) * r * widthX;
      const lz = Math.cos(th) * r * depthZ;
      const k = i * (SEGMENTS + 1) + j;
      positions[k * 3] = p.x + lateral.x * lx + front.x * lz;
      positions[k * 3 + 1] = p.y + lateral.y * lx + front.y * lz;
      positions[k * 3 + 2] = p.z + lateral.z * lx + front.z * lz;
      sulcus[k] = Math.min(1, groove * 1.2);
    }
  }

  const index: number[] = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * (SEGMENTS + 1) + j;
      const b = a + SEGMENTS + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('aSulcus', new BufferAttribute(sulcus, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Lowest point of the stem (object space), used by tests to verify its length. */
export const BRAINSTEM_TIP_Y = -1.32;
