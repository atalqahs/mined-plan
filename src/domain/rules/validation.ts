import { DomainError } from './errors';

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 20_000;
export const CATEGORY_MAX = 40;
export const RELATION_MAX = 40;

export function normalizeTitle(raw: string): string {
  const title = raw.replace(/\s+/g, ' ').trim();
  if (!title) throw new DomainError('TITLE_REQUIRED');
  if (title.length > TITLE_MAX) throw new DomainError('TITLE_TOO_LONG');
  return title;
}

export function clampText(raw: string, max: number): string {
  return raw.length > max ? raw.slice(0, max) : raw;
}

export function assertValidIsoDate(value: string): void {
  if (Number.isNaN(Date.parse(value))) throw new DomainError('INVALID_DATE', value);
}

export function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new DomainError('INVALID_TIMEZONE', tz);
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}
