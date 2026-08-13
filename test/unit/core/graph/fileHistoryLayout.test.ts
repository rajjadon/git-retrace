import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutFileHistory } from '../../../../src/core/graph/fileHistoryLayout';
import type { FileHistoryEntry } from '../../../../src/core/git/types';

function entry(sha: string, author: string, date: string, insertions: number, deletions: number): FileHistoryEntry {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author,
    authorEmail: `${author.toLowerCase()}@example.com`,
    date,
    message: sha,
    insertions,
    deletions,
  };
}

test('layoutFileHistory: empty input produces an empty array', () => {
  assert.deepEqual(layoutFileHistory([], new Date('2024-04-01T00:00:00Z')), []);
});

test('layoutFileHistory: a single author gets lane 0', () => {
  const entries = [entry('A', 'Raj', '2024-01-01T00:00:00Z', 3, 1)];
  const [point] = layoutFileHistory(entries, new Date('2024-04-01T00:00:00Z'));
  assert.equal(point?.lane, 0);
});

test('layoutFileHistory: assigns lanes by order of first appearance, oldest commit first', () => {
  // Newest-first input (as parseFileHistoryLog returns): C(Amy) is newest, A(Raj) is oldest.
  // Raj authored the file first, so Raj should claim lane 0 and Amy lane 1.
  const entries = [
    entry('C', 'Amy', '2024-03-01T00:00:00Z', 1, 0),
    entry('B', 'Raj', '2024-02-01T00:00:00Z', 1, 0),
    entry('A', 'Raj', '2024-01-01T00:00:00Z', 1, 0),
  ];
  const points = layoutFileHistory(entries, new Date('2024-04-01T00:00:00Z'));
  const laneBySha = Object.fromEntries(points.map((p) => [p.entry.sha, p.lane]));
  assert.equal(laneBySha.A, 0);
  assert.equal(laneBySha.B, 0);
  assert.equal(laneBySha.C, 1);
});

test('layoutFileHistory: output preserves the input (newest-first) order', () => {
  const entries = [
    entry('C', 'Raj', '2024-03-01T00:00:00Z', 1, 0),
    entry('B', 'Raj', '2024-02-01T00:00:00Z', 1, 0),
    entry('A', 'Raj', '2024-01-01T00:00:00Z', 1, 0),
  ];
  const points = layoutFileHistory(entries, new Date('2024-04-01T00:00:00Z'));
  assert.deepEqual(
    points.map((p) => p.entry.sha),
    ['C', 'B', 'A'],
  );
});

test('layoutFileHistory: t runs from 0 (oldest) to 1 (now), in between proportionally', () => {
  const entries = [
    entry('C', 'Raj', '2024-04-01T00:00:00Z', 1, 0), // exactly "now"
    entry('B', 'Raj', '2024-03-01T00:00:00Z', 1, 0), // halfway between A and now
    entry('A', 'Raj', '2024-02-01T00:00:00Z', 1, 0), // oldest
  ];
  const now = new Date('2024-04-01T00:00:00Z');
  const points = layoutFileHistory(entries, now);
  const tOf = (sha: string): number | undefined => points.find((p) => p.entry.sha === sha)?.t;
  assert.equal(tOf('A'), 0);
  assert.equal(tOf('C'), 1);
  const tB = tOf('B');
  assert.ok(tB !== undefined && tB > 0 && tB < 1, `expected B strictly between 0 and 1, got ${tB}`);
});

test('layoutFileHistory: a single commit does not divide by zero (t is defined, not NaN)', () => {
  const entries = [entry('A', 'Raj', '2024-04-01T00:00:00Z', 1, 0)];
  const [point] = layoutFileHistory(entries, new Date('2024-04-01T00:00:00Z'));
  assert.ok(Number.isFinite(point?.t));
});

test('layoutFileHistory: magnitude scales 0 (smallest change) to 1 (largest), relative to the dataset', () => {
  const entries = [
    entry('C', 'Raj', '2024-03-01T00:00:00Z', 20, 0), // largest change
    entry('B', 'Raj', '2024-02-01T00:00:00Z', 0, 0), // no change at all
    entry('A', 'Raj', '2024-01-01T00:00:00Z', 5, 5), // mid-size change
  ];
  const points = layoutFileHistory(entries, new Date('2024-04-01T00:00:00Z'));
  const magOf = (sha: string): number | undefined => points.find((p) => p.entry.sha === sha)?.magnitude;
  assert.equal(magOf('C'), 1);
  assert.equal(magOf('B'), 0);
  const magA = magOf('A');
  assert.ok(magA !== undefined && magA > 0 && magA < 1, `expected A strictly between 0 and 1, got ${magA}`);
});

test('layoutFileHistory: magnitude scales by area (sqrt), not linearly — a quarter-sized change reads as roughly half, not a quarter', () => {
  // Linear scaling would give B a magnitude of 100/400 = 0.25, making an ordinary commit look
  // negligible next to one big outlier. Area-proportional (sqrt) scaling gives sqrt(100)/sqrt(400)
  // = 0.5 instead — real bubble/bar charts scale this way so a single huge commit can't flatten
  // every other one to invisible.
  const entries = [
    entry('BIG', 'Raj', '2024-02-01T00:00:00Z', 400, 0),
    entry('SMALL', 'Raj', '2024-01-01T00:00:00Z', 100, 0),
  ];
  const points = layoutFileHistory(entries, new Date('2024-04-01T00:00:00Z'));
  const magOf = (sha: string): number | undefined => points.find((p) => p.entry.sha === sha)?.magnitude;
  const magSmall = magOf('SMALL');
  assert.ok(magSmall !== undefined, 'expected a magnitude for SMALL');
  assert.ok(Math.abs((magSmall ?? 0) - 0.5) < 0.001, `expected sqrt-scaled magnitude ~0.5, got ${magSmall}`);
});
