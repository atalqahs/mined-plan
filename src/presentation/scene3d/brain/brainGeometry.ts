import { BufferAttribute, BufferGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D } from './noise';

/**
 * Procedural, original sculptural brain.
 * Two hemispheres (flattened medial walls, frontal/occipital tapering, temporal
 * lobes), gyri/sulci from domain-warped ridged simplex noise, major fissures
 * (central + lateral), a striated cerebellum and a brainstem — merged into a
 * single geometry (one draw call). A per-vertex `aSulcus` attribute (0..1)
 * marks groove depth for cavity shading and the neural glow.
 */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hemisphere(side: 1 | -1, detail: number, noise: (x: number, y: number, z: number) => number): BufferGeometry {
  let geo: BufferGeometry = new IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-5);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const sulcus = new Float32Array(pos.count);
  // Base surface point, displacement direction and displacement — applied after smoothing.
  const base = new Float32Array(pos.count * 3);
  const dir = new Float32Array(pos.count * 3);
  const dispArr = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    let ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
    const l = Math.hypot(ux, uy, uz);
    ux /= l; uy /= l; uz /= l;

    const lateral = ux * side; // >0 outer surface, <0 medial wall
    const medial = lateral < 0;
    const mx = medial ? ux * 0.26 : ux;

    let px = mx * 0.6;
    let py = uy * 0.64;
    let pz = uz * 0.88;

    const front = smooth(0.15, 1, uz);
    const back = smooth(0.25, 1, -uz);
    px *= 1 - 0.13 * front - 0.16 * back;
    py *= 1 - 0.08 * front - 0.06 * back;
    py -= 0.07 * front;
    py += 0.06 * Math.max(0, uy) * (1 - Math.abs(uz)); // parietal dome
    if (py < -0.22) py = -0.22 + (py + 0.22) * 0.55; // flatter base

    // Temporal lobe: lower, outer, mid-front bulge.
    const temporal = Math.exp(-(((uy + 0.5) / 0.28) ** 2) - ((uz - 0.12) / 0.38) ** 2) * smooth(0.1, 0.6, lateral);
    px += side * 0.07 * temporal;
    py -= 0.06 * temporal;

    // Outward normal estimate for the ellipsoid (displacement direction).
    let nx = px / 0.36, ny = py / 0.41, nz = pz / 0.77;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    // Gyri: domain-warped ridged noise; |n|≈0 lines become sulci.
    // Gentle domain warp makes the zero-set meander like real convolutions.
    const wx = noise(px * 1.3 + 11, py * 1.3, pz * 1.3) * 0.5;
    const wy = noise(px * 1.3, py * 1.3 + 23, pz * 1.3) * 0.5;
    const wz = noise(px * 1.3, py * 1.3, pz * 1.3 + 37) * 0.5;
    // Anisotropic: gyri on the lateral surface run mostly dorso-ventrally.
    const qx = px * 6.8 + wx, qy = py * 4.8 + wy, qz = pz * 6.8 + wz;
    const n = noise(qx, qy, qz) + 0.12 * noise(qx * 2.3 + 5, qy * 2.3, qz * 2.3);
    const ridge = Math.abs(n);
    // Narrow, deep sulci; broad rounded gyri (sqrt-like shoulder).
    // Broad rounded gyri (wide smoothstep) + a crisp sulcus line (narrow smoothstep).
    // Smooth, rounded gyri. No hard crease: a clear-coated surface would turn creases into jagged glints.
    const shoulder = 0.82 * smooth(0.0, 0.46, ridge) + 0.18 * smooth(0.0, 0.16, ridge);
    let groove = 1 - smooth(0.0, 0.2, ridge);
    let disp = -0.058 + 0.058 * shoulder;

    if (!medial) {
      // Lateral (Sylvian) fissure: rises from front-lower towards the back.
      const lineY = -0.24 + (0.6 - uz) * 0.4;
      const dl = Math.abs(uy - lineY);
      const lat = (1 - smooth(0.0, 0.06, dl)) * smooth(-0.45, -0.2, uz) * (1 - smooth(0.55, 0.75, uz)) * smooth(0.2, 0.5, lateral);
      // Central sulcus: from the crown down towards the lateral fissure.
      const lineZ = 0.04 + (1 - uy) * 0.11;
      const dc = Math.abs(uz - lineZ);
      const cen = (1 - smooth(0.0, 0.04, dc)) * smooth(-0.05, 0.15, uy);
      disp -= 0.05 * lat + 0.03 * cen;
      groove = Math.max(groove, lat, cen * 0.85);
    } else {
      disp *= 0.55;
      groove *= 0.6;
    }

    base[i * 3] = px + side * 0.175; base[i * 3 + 1] = py; base[i * 3 + 2] = pz;
    dir[i * 3] = nx; dir[i * 3 + 1] = ny; dir[i * 3 + 2] = nz;
    dispArr[i] = disp;
    sulcus[i] = groove;
  }
  // Laplacian smoothing of the displacement field: removes per-vertex stair-stepping that a
  // clear-coated (glossy) surface would turn into jagged glints, without flattening the folds.
  // Only the dense mesh needs it; on the coarse (software-renderer) mesh averaging would erase the folds.
  if (detail >= 48) {
    smoothField(geo, dispArr, 2, 0.6);
    smoothField(geo, sulcus, 1, 0.5);
  }
  for (let i = 0; i < pos.count; i++) {
    const d = dispArr[i];
    pos.setXYZ(i, base[i * 3] + dir[i * 3] * d, base[i * 3 + 1] + dir[i * 3 + 1] * d, base[i * 3 + 2] + dir[i * 3 + 2] * d);
  }
  geo.setAttribute('aSulcus', new BufferAttribute(sulcus, 1));
  geo.computeVertexNormals();
  return geo;
}

/** In-place neighbour averaging of a per-vertex scalar over an indexed mesh. */
function smoothField(geo: BufferGeometry, field: Float32Array, iterations: number, lambda: number) {
  const index = geo.getIndex();
  if (!index) return;
  const n = field.length;
  const sum = new Float32Array(n);
  const cnt = new Uint16Array(n);
  const idx = index.array;
  for (let it = 0; it < iterations; it++) {
    sum.fill(0);
    cnt.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      sum[a] += field[b] + field[c]; cnt[a] += 2;
      sum[b] += field[a] + field[c]; cnt[b] += 2;
      sum[c] += field[a] + field[b]; cnt[c] += 2;
    }
    for (let i = 0; i < n; i++) if (cnt[i]) field[i] += (sum[i] / cnt[i] - field[i]) * lambda;
  }
}

function cerebellum(detail: number, noise: (x: number, y: number, z: number) => number): BufferGeometry {
  let geo: BufferGeometry = new IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-5);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const sulcus = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
    const l = Math.hypot(ux, uy, uz);
    ux /= l; uy /= l; uz /= l;
    // Two lobes either side of a shallow vermis, tucked under the occipital lobe and clearly visible below it.
    const A = 0.56, B = 0.27, C = 0.34;
    const lobe = 1 + 0.08 * Math.cos(Math.abs(ux) * Math.PI); // slightly fuller lateral lobes
    const px = ux * A, py = uy * B * lobe, pz = uz * C;
    // Folia: fine, gently curved horizontal laminae (the cerebellum's signature striation).
    const s = Math.abs(Math.sin(py * 40 + pz * 6 + noise(px * 3, py * 3, pz * 3) * 1.4));
    const vermis = 1 - smooth(0.0, 0.06, Math.abs(px));
    const groove = Math.max(1 - smooth(0.0, 0.32, s), vermis * 0.75);
    const disp = -0.018 * groove;
    const nl = Math.hypot(px / (A * A), py / (B * B), pz / (C * C)) || 1;
    pos.setXYZ(i, px + (px / (A * A) / nl) * disp, py + (py / (B * B) / nl) * disp - 0.46, pz + (pz / (C * C) / nl) * disp - 0.58);
    sulcus[i] = groove * 0.85;
  }
  geo.setAttribute('aSulcus', new BufferAttribute(sulcus, 1));
  geo.computeVertexNormals();
  return geo;
}

function brainstem(): BufferGeometry {
  let geo: BufferGeometry = new CylinderGeometry(0.105, 0.06, 0.3, 28, 6, true);
  geo.deleteAttribute('uv');
  geo.rotateX(0.32);
  geo.translate(0, -0.6, -0.26);
  geo = mergeVertices(geo, 1e-5);
  geo.setAttribute('aSulcus', new BufferAttribute(new Float32Array(geo.getAttribute('position').count), 1));
  geo.computeVertexNormals();
  return geo;
}

let cache: { key: string; geometry: BufferGeometry } | null = null;

/** Build (or reuse) the brain geometry. `quality` trades triangles for GPU headroom. */
export function getBrainGeometry(quality: 'high' | 'low' = 'high'): BufferGeometry {
  if (cache?.key === quality) return cache.geometry;
  const noise = createNoise3D(7);
  const detail = quality === 'high' ? 62 : 34;
  const merged = mergeGeometries([hemisphere(-1, detail, noise), hemisphere(1, detail, noise), cerebellum(Math.round(detail * 0.55), noise), brainstem()], false);
  if (!merged) throw new Error('brain geometry merge failed');
  merged.center(); // the brain's visual centre sits exactly at the orbit centre
  merged.computeBoundingSphere();
  cache = { key: quality, geometry: merged };
  return merged;
}
