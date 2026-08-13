import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStashes } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';

test('parseStashes: extracts the numeric index from stash@{N} and keeps the message', () => {
  const raw = [`stash@{0}${FIELD}WIP on main: a1b2c3d fix bug`, `stash@{1}${FIELD}WIP on feature: 4e5f6a7 wip`].join('\n');
  assert.deepEqual(parseStashes(raw), [
    { index: 0, message: 'WIP on main: a1b2c3d fix bug' },
    { index: 1, message: 'WIP on feature: 4e5f6a7 wip' },
  ]);
});

test('parseStashes: empty output produces an empty array', () => {
  assert.deepEqual(parseStashes(''), []);
});
