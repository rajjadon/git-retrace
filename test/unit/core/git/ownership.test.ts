import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOwnership, computeLineColors } from '../../../../src/core/git/ownership';
import type { BlameLine } from '../../../../src/core/git/types';

const now = new Date('2024-07-01T00:00:00Z');

function daysAgoSeconds(days: number): number {
  return Math.floor((now.getTime() - days * 86_400_000) / 1000);
}

function line(overrides: Partial<BlameLine> & { line: number }): BlameLine {
  return {
    sha: 'deadbeef',
    author: 'Amy Dev',
    authorEmail: 'amy@example.com',
    authorTime: daysAgoSeconds(0),
    summary: 'a commit',
    isUncommitted: false,
    ...overrides,
  };
}

test('computeOwnership: a single author with all lines today gets 100%', () => {
  const lines = [line({ line: 0 }), line({ line: 1 })];
  const result = computeOwnership(lines, now);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.author, 'Amy Dev');
  assert.equal(result[0]?.lineCount, 2);
  assert.ok(Math.abs((result[0]?.percentage ?? 0) - 100) < 0.001);
});

test('computeOwnership: recency outweighs raw line count — a smaller, more recent share can outrank a larger, older one', () => {
  // Alice: 2 lines from 360 days ago. Bob: 1 line from today. Raw line share would be
  // Alice 66.7% / Bob 33.3%; recency-weighted, Bob's share must be *higher* than his raw count.
  const lines = [
    line({ line: 0, author: 'Alice Dev', authorEmail: 'alice@example.com', authorTime: daysAgoSeconds(360) }),
    line({ line: 1, author: 'Alice Dev', authorEmail: 'alice@example.com', authorTime: daysAgoSeconds(360) }),
    line({ line: 2, author: 'Bob Smith', authorEmail: 'bob@example.com', authorTime: daysAgoSeconds(0) }),
  ];
  const result = computeOwnership(lines, now);
  const alice = result.find((r) => r.authorEmail === 'alice@example.com');
  const bob = result.find((r) => r.authorEmail === 'bob@example.com');
  assert.ok(alice && bob);
  assert.ok(bob.percentage > 100 / 3, `expected Bob's recency-weighted share (${bob.percentage}) above his raw 33.3% line share`);
  assert.ok(alice.percentage < (200 / 3), `expected Alice's recency-weighted share (${alice.percentage}) below her raw 66.7% line share`);
});

test('computeOwnership: percentages sum to 100 across all authors', () => {
  const lines = [
    line({ line: 0, author: 'Alice Dev', authorEmail: 'alice@example.com', authorTime: daysAgoSeconds(10) }),
    line({ line: 1, author: 'Bob Smith', authorEmail: 'bob@example.com', authorTime: daysAgoSeconds(200) }),
    line({ line: 2, author: 'Bob Smith', authorEmail: 'bob@example.com', authorTime: daysAgoSeconds(200) }),
  ];
  const result = computeOwnership(lines, now);
  const total = result.reduce((sum, r) => sum + r.percentage, 0);
  assert.ok(Math.abs(total - 100) < 0.001);
});

test('computeOwnership: decay formula produces the exact expected percentages at 0, 180, and 360 days', () => {
  // weight(0) = 1, weight(180) = 0.5, weight(360) = 0.25 -> total 1.75
  const lines = [
    line({ line: 0, author: 'Today Dev', authorEmail: 'today@example.com', authorTime: daysAgoSeconds(0) }),
    line({ line: 1, author: 'HalfLife Dev', authorEmail: 'halflife@example.com', authorTime: daysAgoSeconds(180) }),
    line({ line: 2, author: 'Old Dev', authorEmail: 'old@example.com', authorTime: daysAgoSeconds(360) }),
  ];
  const result = computeOwnership(lines, now);
  const today = result.find((r) => r.authorEmail === 'today@example.com');
  const halfLife = result.find((r) => r.authorEmail === 'halflife@example.com');
  const old = result.find((r) => r.authorEmail === 'old@example.com');
  assert.ok(today && halfLife && old);
  assert.ok(Math.abs(today.percentage - (1 / 1.75) * 100) < 0.01);
  assert.ok(Math.abs(halfLife.percentage - (0.5 / 1.75) * 100) < 0.01);
  assert.ok(Math.abs(old.percentage - (0.25 / 1.75) * 100) < 0.01);
});

test('computeOwnership: excludes uncommitted lines entirely', () => {
  const lines = [
    line({ line: 0, author: 'Amy Dev', authorEmail: 'amy@example.com' }),
    line({ line: 1, isUncommitted: true }),
  ];
  const result = computeOwnership(lines, now);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.lineCount, 1);
});

test('computeOwnership: returns an empty array when every line is uncommitted', () => {
  const lines = [line({ line: 0, isUncommitted: true })];
  assert.deepEqual(computeOwnership(lines, now), []);
});

test('computeOwnership: sorts most-recently-active author first', () => {
  const lines = [
    line({ line: 0, author: 'Old Author', authorEmail: 'old@example.com', authorTime: daysAgoSeconds(300) }),
    line({ line: 1, author: 'Recent Author', authorEmail: 'recent@example.com', authorTime: daysAgoSeconds(1) }),
  ];
  const result = computeOwnership(lines, now);
  assert.equal(result[0]?.authorEmail, 'recent@example.com');
  assert.equal(result[1]?.authorEmail, 'old@example.com');
});

test('computeOwnership: lastActive is the most recent commit touching that author\'s lines, not the oldest', () => {
  const lines = [
    line({ line: 0, author: 'Amy Dev', authorEmail: 'amy@example.com', authorTime: daysAgoSeconds(100) }),
    line({ line: 1, author: 'Amy Dev', authorEmail: 'amy@example.com', authorTime: daysAgoSeconds(5) }),
  ];
  const result = computeOwnership(lines, now);
  assert.equal(result[0]?.lastActive.getTime(), daysAgoSeconds(5) * 1000);
});

test('computeLineColors: excludes uncommitted lines', () => {
  const lines = [line({ line: 0 }), line({ line: 1, isUncommitted: true })];
  const result = computeLineColors(lines);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.line, 0);
});

test('computeLineColors: the same author email always gets the same color index, regardless of how many other authors are present or their order', () => {
  const solo = computeLineColors([line({ line: 0, authorEmail: 'amy@example.com' })]);
  const crowded = computeLineColors([
    line({ line: 0, authorEmail: 'zack@example.com' }),
    line({ line: 1, authorEmail: 'bob@example.com' }),
    line({ line: 2, authorEmail: 'amy@example.com' }),
  ]);
  const amyAlone = solo.find((r) => r.line === 0)?.colorIndex;
  const amyCrowded = crowded.find((r) => r.line === 2)?.colorIndex;
  assert.equal(amyAlone, amyCrowded);
});

test('computeLineColors: different authors can land in different color buckets', () => {
  // Not guaranteed for every possible pair (only 7 colors), but true for this specific pair —
  // pins the hash isn't accidentally constant-for-everyone.
  const result = computeLineColors([
    line({ line: 0, authorEmail: 'amy@example.com' }),
    line({ line: 1, authorEmail: 'completely-different-person@example.com' }),
  ]);
  assert.notEqual(result[0]?.colorIndex, result[1]?.colorIndex);
});
