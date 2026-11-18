/**
 * Domain errors carry a stable machine code. The presentation layer maps codes
 * to localized (Arabic) messages — the domain never contains UI copy.
 */
export type DomainErrorCode =
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'NODE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'HIERARCHY_CYCLE'
  | 'SELF_PARENT'
  | 'EDGE_SELF_LOOP'
  | 'EDGE_DUPLICATE'
  | 'EDGE_NOT_FOUND'
  | 'REMINDER_NOT_FOUND'
  | 'INVALID_DATE'
  | 'INVALID_TIMEZONE';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DomainError';
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
