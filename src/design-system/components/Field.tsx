import { useId, type ReactElement, cloneElement } from 'react';
import styles from './Field.module.css';

export const controlClass = styles.control;

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  /** A single input/select/textarea; receives id, className and aria wiring. */
  children: ReactElement<Record<string, unknown>>;
  hideLabel?: boolean;
}

/** Visible label + control + hint/error under the field (never placeholder-only). */
export function Field({ label, hint, error, children, hideLabel }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const child = cloneElement(children, {
    id,
    className: [styles.control, children.props.className].filter(Boolean).join(' '),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
  });
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : styles.label}>
        {label}
      </label>
      {child}
      {hint && !error ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
