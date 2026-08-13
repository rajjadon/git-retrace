import type { FileHistoryEntry } from '../git/types';

export interface FileHistoryPoint {
  entry: FileHistoryEntry;
  /** Column this author's lane is drawn in, assigned in order of first appearance (oldest commit first). */
  lane: number;
  /** 0 (oldest commit in this set) to 1 (`now`), for the renderer to place this point on the time axis. */
  t: number;
  /** 0 (smallest `insertions + deletions` in this set) to 1 (largest), area-proportional (sqrt-scaled) rather than linear, so one outlier commit can't flatten every other bubble/bar to invisible. For the renderer to scale bubble radius / bar height. */
  magnitude: number;
}

/**
 * Assigns each file-history entry a time position, an author lane, and a relative change
 * magnitude, for the Visual File History bubble timeline. Pure — no I/O.
 *
 * `entries` is expected newest-first (as `parseFileHistoryLog` returns it); lanes are assigned
 * scanning oldest-first instead, so the file's original author claims lane 0.
 */
export function layoutFileHistory(entries: FileHistoryEntry[], now: Date): FileHistoryPoint[] {
  if (entries.length === 0) {
    return [];
  }

  const oldestToNewest = [...entries].reverse();

  const laneByAuthor = new Map<string, number>();
  for (const entry of oldestToNewest) {
    if (!laneByAuthor.has(entry.authorEmail)) {
      laneByAuthor.set(entry.authorEmail, laneByAuthor.size);
    }
  }

  const oldestTime = new Date(oldestToNewest[0]?.date ?? now).getTime();
  const nowTime = now.getTime();
  const timeSpan = nowTime - oldestTime;

  const maxChange = Math.max(...entries.map((e) => e.insertions + e.deletions));
  const maxMagnitude = Math.sqrt(maxChange);

  return entries.map((entry) => {
    const entryTime = new Date(entry.date).getTime();
    const t = timeSpan > 0 ? (entryTime - oldestTime) / timeSpan : 1;
    const magnitude = maxMagnitude > 0 ? Math.sqrt(entry.insertions + entry.deletions) / maxMagnitude : 0;
    return {
      entry,
      lane: laneByAuthor.get(entry.authorEmail) ?? 0,
      t,
      magnitude,
    };
  });
}
