import type { BlameLine } from './types';

/** Zero `vscode` imports — pure data in, pure data out, per GitLore's `core/` dependency rule. */
export interface StaleInfo {
  sha: string;
  lastTouched: Date;
  ageDays: number;
}

/**
 * Finds the most recently touched line inside [startLine, endLine] (inclusive, 0-based, matching
 * both `BlameLine.line` and `vscode.Position.line`) and reports it as stale if that line is older
 * than `thresholdDays`. Any uncommitted line in range means the symbol is being actively edited
 * right now — the opposite of stale — so the whole range is reported as not-stale regardless of
 * how old its other lines are.
 */
export function findStaleSymbol(
  blameLines: BlameLine[],
  startLine: number,
  endLine: number,
  thresholdDays: number,
  now: Date,
): StaleInfo | null {
  const inRange = blameLines.filter((l) => l.line >= startLine && l.line <= endLine);
  if (inRange.length === 0 || inRange.some((l) => l.isUncommitted)) {
    return null;
  }

  let newest: BlameLine | null = null;
  for (const candidate of inRange) {
    if (newest === null || candidate.authorTime > newest.authorTime) {
      newest = candidate;
    }
  }
  if (newest === null) {
    return null;
  }

  const lastTouched = new Date(newest.authorTime * 1000);
  const ageDays = (now.getTime() - lastTouched.getTime()) / 86_400_000;
  if (ageDays <= thresholdDays) {
    return null;
  }

  return { sha: newest.sha, lastTouched, ageDays };
}
