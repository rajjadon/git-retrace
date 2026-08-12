import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findStaleSymbol } from '../../../../src/core/git/staleness';
import type { BlameLine } from '../../../../src/core/git/types';

process.env.TZ = 'UTC';

const now = new Date('2024-06-01T00:00:00Z');

function daysAgo(days: number): number {
  return Math.floor((now.getTime() - days * 86_400_000) / 1000);
}

function line(overrides: Partial<BlameLine> & { line: number }): BlameLine {
  return {
    sha: 'deadbeef',
    author: 'Amy Dev',
    authorEmail: 'amy@example.com',
    authorTime: daysAgo(0),
    summary: 'a commit',
    isUncommitted: false,
    ...overrides,
  };
}

test('findStaleSymbol: returns null when the most recently touched line is within the threshold', () => {
  const blameLines = [line({ line: 0, authorTime: daysAgo(10) }), line({ line: 1, authorTime: daysAgo(5) })];
  assert.equal(findStaleSymbol(blameLines, 0, 1, 180, now), null);
});

test('findStaleSymbol: returns the sha and age of the most recently touched line, when older than the threshold', () => {
  const blameLines = [
    line({ line: 0, sha: 'aaa111', authorTime: daysAgo(200) }),
    line({ line: 1, sha: 'bbb222', authorTime: daysAgo(210) }),
  ];
  const result = findStaleSymbol(blameLines, 0, 1, 180, now);
  assert.ok(result);
  assert.equal(result.sha, 'aaa111'); // line 0 is the more recent of the two — 200 days old, not 210
  assert.equal(result.lastTouched.getTime(), daysAgo(200) * 1000);
  assert.ok(Math.abs(result.ageDays - 200) < 0.01);
});

test('findStaleSymbol: takes the most recent line, not the oldest — a fresh line keeps the symbol non-stale even if an older line in range would be stale alone', () => {
  const blameLines = [
    line({ line: 0, authorTime: daysAgo(40) }), // would be stale alone at a 30-day threshold
    line({ line: 1, authorTime: daysAgo(10) }), // most recent — keeps the whole range non-stale
  ];
  assert.equal(findStaleSymbol(blameLines, 0, 1, 30, now), null);
});

test('findStaleSymbol: any uncommitted line in range means "actively being edited", never stale', () => {
  const blameLines = [
    line({ line: 0, authorTime: daysAgo(400) }),
    line({ line: 1, isUncommitted: true, authorTime: daysAgo(0) }),
  ];
  assert.equal(findStaleSymbol(blameLines, 0, 1, 180, now), null);
});

test('findStaleSymbol: returns null when no blame line falls inside the range', () => {
  const blameLines = [line({ line: 5, authorTime: daysAgo(400) })];
  assert.equal(findStaleSymbol(blameLines, 0, 2, 180, now), null);
});

test('findStaleSymbol: exactly at the threshold is not yet stale (boundary is exclusive)', () => {
  const blameLines = [line({ line: 0, authorTime: daysAgo(180) })];
  assert.equal(findStaleSymbol(blameLines, 0, 0, 180, now), null);
});

test('findStaleSymbol: one day past the threshold is stale', () => {
  const blameLines = [line({ line: 0, sha: 'ccc333', authorTime: daysAgo(181) })];
  const result = findStaleSymbol(blameLines, 0, 0, 180, now);
  assert.ok(result);
  assert.equal(result.sha, 'ccc333');
});
