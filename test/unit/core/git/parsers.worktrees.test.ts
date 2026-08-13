import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorktrees } from '../../../../src/core/git/parsers';

test('parseWorktrees: parses the main checkout and a linked worktree, main first', () => {
  const raw = [
    'worktree /repo',
    'HEAD abc1234567890abc1234567890abc1234567890',
    'branch refs/heads/main',
    '',
    'worktree /repo-feature',
    'HEAD def4567890abc1234567890abc1234567890abc',
    'branch refs/heads/feature-x',
    '',
  ].join('\n');
  assert.deepEqual(parseWorktrees(raw), [
    { path: '/repo', branch: 'main', isMain: true },
    { path: '/repo-feature', branch: 'feature-x', isMain: false },
  ]);
});

test('parseWorktrees: a detached-HEAD worktree has a null branch', () => {
  const raw = ['worktree /repo', 'HEAD abc1234567890abc1234567890abc1234567890', 'detached', ''].join('\n');
  assert.deepEqual(parseWorktrees(raw), [{ path: '/repo', branch: null, isMain: true }]);
});

test('parseWorktrees: empty output produces an empty array', () => {
  assert.deepEqual(parseWorktrees(''), []);
});
