import type { BlameLine } from './types';
import { CHART_THEME_COLOR_IDS } from '../../utils/colors';

/**
 * Days for a line's contribution to its author's ownership score to decay by half. Hardcoded for
 * v1, not a setting — see docs/superpowers/specs/2026-08-13-author-ownership-heatmap-design.md.
 */
const HALF_LIFE_DAYS = 180;

export interface AuthorOwnership {
  author: string;
  authorEmail: string;
  lineCount: number;
  /** 0-100, recency-weighted, summing to 100 (within floating-point tolerance) across all returned authors. */
  percentage: number;
  lastActive: Date;
}

export interface LineOwnership {
  /** 0-based line index, matching `BlameLine.line`. */
  line: number;
  /** Stable per-author index into the shared chart-color palette (see `utils/colors.ts`). */
  colorIndex: number;
}

/** A simple, deterministic string hash (djb2-like) — stable across runs/processes. */
function hashToIndex(value: string, modulus: number): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulus;
}

function decayWeight(ageDays: number): number {
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/**
 * Direct per-line color assignment for the overview-ruler heatmap: whichever author git blame
 * attributes a line to gets that author's stable color, no weighting or decay — git blame already
 * attributes exactly one author per line, so there's no ambiguity to resolve here. Uncommitted
 * lines are omitted; they have no settled author yet.
 */
export function computeLineColors(blameLines: BlameLine[]): LineOwnership[] {
  return blameLines
    .filter((entry) => !entry.isUncommitted)
    .map((entry) => ({
      line: entry.line,
      colorIndex: hashToIndex(entry.authorEmail, CHART_THEME_COLOR_IDS.length),
    }));
}

interface Accumulator {
  author: string;
  authorEmail: string;
  lineCount: number;
  score: number;
  lastActiveSeconds: number;
}

/**
 * Aggregates committed blame lines into per-author recency-weighted ownership, for the
 * `gitLore.showFileOwnership` command's ranking. Each line's contribution to its author's score
 * decays exponentially by the age of the commit that touched it — a line touched yesterday counts
 * far more than one untouched for years, but old lines still count for something, not zero.
 * Uncommitted lines are excluded (no settled author yet). Returns authors sorted
 * most-recently-active first. This has no effect on `computeLineColors`'s per-line color, which
 * stays a direct, unweighted blame lookup.
 */
export function computeOwnership(blameLines: BlameLine[], now: Date): AuthorOwnership[] {
  const committed = blameLines.filter((entry) => !entry.isUncommitted);
  if (committed.length === 0) {
    return [];
  }

  const byEmail = new Map<string, Accumulator>();
  for (const entry of committed) {
    const ageDays = (now.getTime() / 1000 - entry.authorTime) / 86_400;
    const weight = decayWeight(ageDays);
    const existing = byEmail.get(entry.authorEmail);
    if (existing) {
      existing.lineCount += 1;
      existing.score += weight;
      existing.lastActiveSeconds = Math.max(existing.lastActiveSeconds, entry.authorTime);
    } else {
      byEmail.set(entry.authorEmail, {
        author: entry.author,
        authorEmail: entry.authorEmail,
        lineCount: 1,
        score: weight,
        lastActiveSeconds: entry.authorTime,
      });
    }
  }

  const totalScore = Array.from(byEmail.values()).reduce((sum, acc) => sum + acc.score, 0);

  return Array.from(byEmail.values())
    .map((acc) => ({
      author: acc.author,
      authorEmail: acc.authorEmail,
      lineCount: acc.lineCount,
      percentage: totalScore > 0 ? (acc.score / totalScore) * 100 : 0,
      lastActive: new Date(acc.lastActiveSeconds * 1000),
    }))
    .sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
}
