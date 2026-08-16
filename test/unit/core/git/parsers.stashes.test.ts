import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStashes } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';

test('parseStashes: extracts the numeric index, message, and base commit sha (first parent)', () => {
  const raw = [
    `stash@{0}${FIELD}WIP on main: a1b2c3d fix bug${FIELD}a1b2c3d4e5f60708090a0b0c0d0e0f1011121314 9f8e7d6c5b4a39281706050403020100ffeeddc`,
    `stash@{1}${FIELD}WIP on feature: 4e5f6a7 wip${FIELD}4e5f6a70b1c2d3e4f5061708090a0b0c0d0e0f10`,
  ].join('\n');
  assert.deepEqual(parseStashes(raw), [
    { index: 0, message: 'WIP on main: a1b2c3d fix bug', baseSha: 'a1b2c3d4e5f60708090a0b0c0d0e0f1011121314' },
    { index: 1, message: 'WIP on feature: 4e5f6a7 wip', baseSha: '4e5f6a70b1c2d3e4f5061708090a0b0c0d0e0f10' },
  ]);
});

test('parseStashes: empty output produces an empty array', () => {
  assert.deepEqual(parseStashes(''), []);
});
