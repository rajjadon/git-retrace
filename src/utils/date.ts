import { formatDistance } from 'date-fns/formatDistance';
import { format } from 'date-fns/format';

/** Relative age string, e.g. "3 days ago". `now` is injectable for deterministic tests. */
export function formatAge(date: Date, now: Date = new Date()): string {
  return formatDistance(date, now, { addSuffix: true });
}

/** Absolute date string using a date-fns format pattern, e.g. "yyyy-MM-dd". */
export function formatAbsolute(date: Date, pattern: string): string {
  return format(date, pattern);
}
