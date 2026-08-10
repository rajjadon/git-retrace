import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumstat } from '../../../../src/core/git/parsers';

test('parseNumstat: parses a normal text-file change', () => {
  assert.deepEqual(parseNumstat('3\t1\ttracked.txt\n'), {
    path: 'tracked.txt',
    insertions: 3,
    deletions: 1,
    binary: false,
  });
});

test('parseNumstat: binary files report "-" for both counts', () => {
  assert.deepEqual(parseNumstat('-\t-\timage.png\n'), {
    path: 'image.png',
    insertions: 0,
    deletions: 0,
    binary: true,
  });
});

test('parseNumstat: empty output produces null', () => {
  assert.equal(parseNumstat(''), null);
});

test('parseNumstat: only reads the first line', () => {
  assert.deepEqual(parseNumstat('2\t0\ta.txt\n5\t5\tb.txt\n'), {
    path: 'a.txt',
    insertions: 2,
    deletions: 0,
    binary: false,
  });
});
