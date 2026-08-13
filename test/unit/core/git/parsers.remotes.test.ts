import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemotes } from '../../../../src/core/git/parsers';

test('parseRemotes: parses one remote name and url per line', () => {
  const raw = 'remote.origin.url https://github.com/x/y.git\nremote.upstream.url git@github.com:a/b.git\n';
  assert.deepEqual(parseRemotes(raw), [
    { name: 'origin', url: 'https://github.com/x/y.git' },
    { name: 'upstream', url: 'git@github.com:a/b.git' },
  ]);
});

test('parseRemotes: ignores unrelated config keys matched by the same regexp query', () => {
  const raw = 'remote.origin.url https://github.com/x/y.git\nremote.origin.fetch +refs/heads/*:refs/remotes/origin/*\n';
  assert.deepEqual(parseRemotes(raw), [{ name: 'origin', url: 'https://github.com/x/y.git' }]);
});

test('parseRemotes: empty output produces an empty array', () => {
  assert.deepEqual(parseRemotes(''), []);
});
