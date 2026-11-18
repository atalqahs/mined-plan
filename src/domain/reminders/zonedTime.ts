/**
 * Minimal timezone arithmetic built on Intl (no dependencies).
 * Wall-clock parts are expressed in a given IANA zone.
 */
export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function toWallClock(instant: Date, tz: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}

/** Offset (ms) of `tz` relative to UTC at `instant`. */
function offsetAt(instant: Date, tz: string): number {
  const w = toWallClock(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert wall-clock time in `tz` to an absolute instant. Uses two offset
 * passes so DST transitions resolve to a valid instant (gaps roll forward).
 */
export function fromWallClock(w: WallClock, tz: string): Date {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  let guess = naive - offsetAt(new Date(naive), tz);
  guess = naive - offsetAt(new Date(guess), tz);
  return new Date(guess);
}

/** Calendar day key (YYYY-MM-DD) of an instant in a zone. */
export function dayKey(instant: Date, tz: string): string {
  const w = toWallClock(instant, tz);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
