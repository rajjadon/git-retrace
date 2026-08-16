import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoChangeLog } from '../../../../src/core/git/parsers';

const RS = '\x1e';

test('parseCoChangeLog: one file list per commit, sha first', () => {
  const raw = [`${RS}a1b2c3`, 'src/a.ts', 'src/b.ts', '', `${RS}d4e5f6`, 'src/a.ts', ''].join('\n');
  assert.deepEqual(parseCoChangeLog(raw), [
    { sha: 'a1b2c3', files: ['src/a.ts', 'src/b.ts'] },
    { sha: 'd4e5f6', files: ['src/a.ts'] },
  ]);
});

test('parseCoChangeLog: a commit that touched no files (e.g. an empty commit) still yields its sha', () => {
  const raw = `${RS}a1b2c3\n`;
  assert.deepEqual(parseCoChangeLog(raw), [{ sha: 'a1b2c3', files: [] }]);
});

test('parseCoChangeLog: empty output produces an empty array', () => {
  assert.deepEqual(parseCoChangeLog(''), []);
});
