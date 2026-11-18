import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Local editing buffer for a persisted text value.
 * Commits after `delay` ms of inactivity, on blur (call `flush`) and on unmount,
 * so switching ideas mid-sentence never loses text.
 */
export function useDraft(value: string, commit: (v: string) => void, delay = 700) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Adopt external changes (undo/redo, import) when the user isn't mid-edit.
  useEffect(() => {
    if (pending.current === null) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      const v = pending.current;
      pending.current = null;
      commitRef.current(v);
    }
  }, []);

  const change = useCallback(
    (v: string) => {
      setDraft(v);
      pending.current = v;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => flush, [flush]);

  return { draft, change, flush, reset: () => { pending.current = null; setDraft(value); } };
}
