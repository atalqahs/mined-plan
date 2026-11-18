import { useEffect, useRef } from 'react';
import type { ControlCommand } from '@/application/remote/protocol';
import { t } from '@/presentation/i18n/ar';
import styles from './Controller.module.css';

const ORBIT_GAIN = 0.0065; // radians per CSS px
const MAX_STEP = 1.2;

/**
 * Remote touch surface: one finger orbits, two fingers pinch-zoom (mouse: drag + wheel).
 * Gestures are accumulated and flushed at most once per animation frame, so the link
 * carries a steady, small stream of commands rather than every pointer event.
 */
export function TouchPad({ send }: { send(cmd: ControlCommand): boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pending = useRef({ az: 0, pol: 0, zoom: 1 });
  const raf = useRef<number | null>(null);
  const pinch = useRef<number | null>(null);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  const flush = () => {
    raf.current = null;
    const p = pending.current;
    if (p.az || p.pol) send({ t: 'orbit', az: clamp(p.az), pol: clamp(p.pol) });
    if (Math.abs(p.zoom - 1) > 0.001) send({ t: 'zoom', factor: Math.min(4, Math.max(0.25, p.zoom)) });
    pending.current = { az: 0, pol: 0, zoom: 1 };
  };
  const schedule = () => {
    if (raf.current === null) raf.current = requestAnimationFrame(flush);
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };

  return (
    <div
      ref={el}
      className={styles.pad}
      data-testid="touch-pad"
      role="application"
      aria-label={t.tv.padHint}
      onPointerDown={(e) => {
        el.current?.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        pinch.current = distance();
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const next = { x: e.clientX, y: e.clientY };
        pointers.current.set(e.pointerId, next);
        if (pointers.current.size >= 2) {
          const d = distance();
          if (d && pinch.current) {
            pending.current.zoom *= d / pinch.current;
            pinch.current = d;
            schedule();
          }
          return;
        }
        pending.current.az -= (next.x - prev.x) * ORBIT_GAIN;
        pending.current.pol -= (next.y - prev.y) * ORBIT_GAIN;
        schedule();
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = distance();
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onWheel={(e) => {
        pending.current.zoom *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
        schedule();
      }}
    >
      <span className={styles.padHint}>{t.tv.padHint}</span>
    </div>
  );
}

function clamp(v: number) {
  return Math.max(-MAX_STEP, Math.min(MAX_STEP, v));
}
