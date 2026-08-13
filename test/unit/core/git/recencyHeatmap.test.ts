import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecencyBuckets } from '../../../../src/core/git/recencyHeatmap';
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

test('computeRecencyBuckets: the most recent line gets bucket 0, the oldest gets the last bucket', () => {
  const lines = [
    line({ line: 0, authorTime: daysAgoSeconds(0) }),
    line({ line: 1, authorTime: daysAgoSeconds(400) }),
  ];
  const result = computeRecencyBuckets(lines, now, 5);
  assert.equal(result.find((r) => r.line === 0)?.bucketIndex, 0);
  assert.equal(result.find((r) => r.line === 1)?.bucketIndex, 4);
});

test('computeRecencyBuckets: spreads intermediate ages proportionally across the bucket range', () => {
  // Span is 0 to 400 days old, in quarters: 0, 100, 200, 300, 400 -> buckets 0 through 4 of 5.
  const lines = [
    line({ line: 0, authorTime: daysAgoSeconds(0) }),
    line({ line: 1, authorTime: daysAgoSeconds(100) }),
    line({ line: 2, authorTime: daysAgoSeconds(200) }),
    line({ line: 3, authorTime: daysAgoSeconds(300) }),
    line({ line: 4, authorTime: daysAgoSeconds(400) }),
  ];
  const result = computeRecencyBuckets(lines, now, 5);
  assert.deepEqual(
    result.map((r) => r.bucketIndex),
    [0, 1, 2, 3, 4],
  );
});

test('computeRecencyBuckets: every line the same age (a single-commit file) all land in bucket 0, not NaN', () => {
  const lines = [line({ line: 0, authorTime: daysAgoSeconds(50) }), line({ line: 1, authorTime: daysAgoSeconds(50) })];
  const result = computeRecencyBuckets(lines, now, 5);
  assert.deepEqual(
    result.map((r) => r.bucketIndex),
    [0, 0],
  );
});

test('computeRecencyBuckets: excludes uncommitted lines, matching computeOwnership/computeLineColors', () => {
  const lines = [line({ line: 0 }), line({ line: 1, isUncommitted: true })];
  const result = computeRecencyBuckets(lines, now, 5);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.line, 0);
});

test('computeRecencyBuckets: returns an empty array when every line is uncommitted', () => {
  assert.deepEqual(computeRecencyBuckets([line({ line: 0, isUncommitted: true })], now, 5), []);
});

test('computeRecencyBuckets: returns an empty array for an empty file', () => {
  assert.deepEqual(computeRecencyBuckets([], now, 5), []);
});

test('computeRecencyBuckets: never returns a bucket index outside [0, bucketCount)', () => {
  const lines = Array.from({ length: 20 }, (_, i) => line({ line: i, authorTime: daysAgoSeconds(i * 17) }));
  const result = computeRecencyBuckets(lines, now, 5);
  for (const { bucketIndex } of result) {
    assert.ok(bucketIndex >= 0 && bucketIndex < 5, `bucketIndex ${bucketIndex} out of range`);
  }
});
