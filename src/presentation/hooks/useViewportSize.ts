import { useEffect, useState } from 'react';

/** Window size in CSS px, updated on resize / orientation change. */
export function useViewportSize() {
  const read = () => ({ width: typeof window === 'undefined' ? 1920 : window.innerWidth, height: typeof window === 'undefined' ? 1080 : window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return size;
}
