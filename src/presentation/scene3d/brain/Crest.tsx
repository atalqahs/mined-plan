import { useMemo } from 'react';
import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Path, Shape, Vector2 } from 'three';
import { palette } from '@/design-system/tokens/palette';

/**
 * The plinth beneath the brain — an instrument dial whose outer contour borrows a
 * bat-wing *geometric language* (scalloped trailing edges on the flanks, two sharp
 * cowl-like fins at the front) without reproducing any existing emblem.
 */
const Y = -1.45;
const R = 3.1;
const INNER = 2.25;

function outline(segments = 360): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2; // 0 = front (+z)
    const side = Math.abs(Math.sin(th));
    // Three scallops per flank, fading toward front and back.
    const scW = Math.max(0, (side - 0.42) / 0.58);
    const phase = (Math.abs(th - Math.PI) / Math.PI) * 4.5; // 0 at back
    const scallop = 0.22 * scW * Math.pow(Math.abs(Math.sin(phase * Math.PI)), 0.55);
    const r = R - scallop;
    pts.push(new Vector2(Math.sin(th) * r, Math.cos(th) * r));
  }
  return pts;
}

function finShape(): Shape {
  const s = new Shape();
  s.moveTo(-0.11, 0);
  s.lineTo(0.0, 0.5);
  s.lineTo(0.06, 0.12);
  s.lineTo(0.11, 0);
  s.closePath();
  return s;
}

export function Crest() {
  const { plate, rim, ticks, fin } = useMemo(() => {
    const pts = outline();
    const shape = new Shape(pts);
    const hole = new Path();
    hole.absarc(0, 0, INNER, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const plate = new ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1, curveSegments: 64 });
    plate.rotateX(-Math.PI / 2);
    plate.translate(0, Y, 0);

    const rimPos: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      rimPos.push(a.x, Y + 0.072, -a.y, b.x, Y + 0.072, -b.y);
    }
    const rim = new BufferGeometry();
    rim.setAttribute('position', new Float32BufferAttribute(rimPos, 3));

    const tickPos: number[] = [];
    for (let i = 0; i < 120; i++) {
      const th = (i / 120) * Math.PI * 2;
      const len = i % 10 === 0 ? 0.24 : 0.1;
      const c = Math.cos(th), s = Math.sin(th);
      tickPos.push(s * (INNER + 0.06), Y + 0.075, c * (INNER + 0.06), s * (INNER + 0.06 + len), Y + 0.075, c * (INNER + 0.06 + len));
    }
    const ticks = new BufferGeometry();
    ticks.setAttribute('position', new Float32BufferAttribute(tickPos, 3));

    const fin = new ExtrudeGeometry(finShape(), { depth: 0.025, bevelEnabled: false });
    return { plate, rim, ticks, fin };
  }, []);

  return (
    <group raycast={() => null}>
      <mesh geometry={plate} raycast={() => null}>
        <meshStandardMaterial color="#1a222c" metalness={0.92} roughness={0.42} envMapIntensity={0.9} />
      </mesh>
      <lineSegments geometry={rim} raycast={() => null}>
        <lineBasicMaterial color={palette.gold} transparent opacity={0.55} />
      </lineSegments>
      <lineSegments geometry={ticks} raycast={() => null}>
        <lineBasicMaterial color={palette.steel} transparent opacity={0.5} />
      </lineSegments>
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={fin} position={[s * 0.48, Y + 0.05, R - 0.06]} rotation={[0, 0, s * -0.12]} raycast={() => null}>
          <meshStandardMaterial color="#232c37" metalness={0.9} roughness={0.35} emissive={palette.gold} emissiveIntensity={0.08} />
        </mesh>
      ))}
    </group>
  );
}
