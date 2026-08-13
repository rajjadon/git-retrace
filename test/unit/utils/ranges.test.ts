import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesceLineRanges } from '../../../src/utils/ranges';

test('coalesceLineRanges: merges consecutive line numbers into one range', () => {
  assert.deepEqual(coalesceLineRanges([0, 1, 2]), [{ start: 0, end: 2 }]);
});

test('coalesceLineRanges: splits at a gap', () => {
  assert.deepEqual(coalesceLineRanges([0, 1, 2, 5]), [
    { start: 0, end: 2 },
    { start: 5, end: 5 },
  ]);
});

test('coalesceLineRanges: a single line is its own one-line range', () => {
  assert.deepEqual(coalesceLineRanges([7]), [{ start: 7, end: 7 }]);
});

test('coalesceLineRanges: empty input produces no ranges', () => {
  assert.deepEqual(coalesceLineRanges([]), []);
});

test('coalesceLineRanges: every line separate produces one range per line', () => {
  assert.deepEqual(coalesceLineRanges([1, 3, 5]), [
    { start: 1, end: 1 },
    { start: 3, end: 3 },
    { start: 5, end: 5 },
  ]);
});
