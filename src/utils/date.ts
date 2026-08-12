import { formatDistance } from 'date-fns/formatDistance';
import { format } from 'date-fns/format';

/**
 * Relative age string, e.g. "3 days ago". `now` is injectable for deterministic tests.
 *
 * date-fns hedges hour- and year-scale distances as "about 10 hours ago" / "about 1 year ago".
 * Every relative age is approximate, so the word carries no information — and it cost ~40px on
 * every row, which was enough to truncate the commit graph's date column to "about 10 hou…".
 * Dropped, matching how GitHub renders the same value.
 */
export function formatAge(date: Date, now: Date = new Date()): string {
  return formatDistance(date, now, { addSuffix: true }).replace(/^about /, '');
}

/** Absolute date string using a date-fns format pattern, e.g. "yyyy-MM-dd". */
export function formatAbsolute(date: Date, pattern: string): string {
  return format(date, pattern);
}
