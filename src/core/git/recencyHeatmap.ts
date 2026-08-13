import type { BlameLine } from './types';

export interface LineRecency {
  /** 0-based line index, matching `BlameLine.line`. */
  line: number;
  /** 0 = hottest (most recently changed), `bucketCount - 1` = coldest. */
  bucketIndex: number;
}

/**
 * Buckets each committed line by its age *relative to the oldest and newest committed line in
 * this same file* — not an absolute day threshold. A file whose entire history is five years old
 * still shows a hot-to-cold gradient across its own lines; a threshold scaled to "days old" would
 * render it uniformly cold and tell the reader nothing. Uncommitted lines are omitted, matching
 * `computeLineColors`/`computeOwnership` — they have no settled age yet.
 */
export function computeRecencyBuckets(blameLines: BlameLine[], now: Date, bucketCount: number): LineRecency[] {
  const committed = blameLines.filter((entry) => !entry.isUncommitted);
  if (committed.length === 0 || bucketCount <= 0) {
    return [];
  }

  const nowSeconds = now.getTime() / 1000;
  const ages = committed.map((entry) => nowSeconds - entry.authorTime);
  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);
  const span = maxAge - minAge;

  return committed.map((entry, i) => {
    const age = ages[i] ?? 0;
    // A single-commit file (or one where every remaining line happens to share an age) has no
    // spread to normalize against — everything is equally "the newest thing here", bucket 0.
    const normalized = span === 0 ? 0 : (age - minAge) / span;
    const bucketIndex = Math.min(bucketCount - 1, Math.floor(normalized * bucketCount));
    return { line: entry.line, bucketIndex };
  });
}
