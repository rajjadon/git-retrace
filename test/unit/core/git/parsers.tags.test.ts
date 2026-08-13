import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags } from '../../../../src/core/git/parsers';

test('parseTags: one tag name per line', () => {
  assert.deepEqual(parseTags('v1.0.0\nv1.1.0\n'), [{ name: 'v1.0.0' }, { name: 'v1.1.0' }]);
});

test('parseTags: empty output produces an empty array', () => {
  assert.deepEqual(parseTags(''), []);
});
