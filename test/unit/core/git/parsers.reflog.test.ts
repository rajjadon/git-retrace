import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReflog } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';

test('parseReflog: extracts sha, selector, message, and date per entry', () => {
  const raw = [
    `a1b2c3d4e5f60708090a0b0c0d0e0f1011121314${FIELD}HEAD@{0}${FIELD}reset: moving to HEAD~1${FIELD}2026-08-19T10:00:00+05:30`,
    `4e5f6a70b1c2d3e4f5061708090a0b0c0d0e0f10${FIELD}HEAD@{1}${FIELD}commit: fix bug${FIELD}2026-08-19T09:00:00+05:30`,
  ].join('\n');
  assert.deepEqual(parseReflog(raw), [
    { sha: 'a1b2c3d4e5f60708090a0b0c0d0e0f1011121314', selector: 'HEAD@{0}', message: 'reset: moving to HEAD~1', date: '2026-08-19T10:00:00+05:30' },
    { sha: '4e5f6a70b1c2d3e4f5061708090a0b0c0d0e0f10', selector: 'HEAD@{1}', message: 'commit: fix bug', date: '2026-08-19T09:00:00+05:30' },
  ]);
});

test('parseReflog: empty output produces an empty array', () => {
  assert.deepEqual(parseReflog(''), []);
});
