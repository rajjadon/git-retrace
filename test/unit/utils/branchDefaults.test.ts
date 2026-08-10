import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultRefs } from '../../../src/utils/branchDefaults';
import type { BranchInfo } from '../../../src/core/git/types';

function branch(name: string, isRemote = false, isCurrent = false): BranchInfo {
  return { name, isRemote, isCurrent };
}

test('pickDefaultRefs: compares the current branch against its remote-tracking counterpart', () => {
  const branches = [branch('main', false, true), branch('feature-x'), branch('origin/main', true)];
  assert.deepEqual(pickDefaultRefs(branches, 'main'), { base: 'origin/main', compare: 'main' });
});

test('pickDefaultRefs: falls back to another local branch when there is no upstream', () => {
  const branches = [branch('main', false, true), branch('feature-x')];
  assert.deepEqual(pickDefaultRefs(branches, 'main'), { base: 'feature-x', compare: 'main' });
});

test('pickDefaultRefs: uses the branch flagged current when the branch name is unknown', () => {
  // Detached HEAD reports no branch name, but for-each-ref may still mark one.
  const branches = [branch('feature-x'), branch('main', false, true), branch('origin/main', true)];
  assert.deepEqual(pickDefaultRefs(branches, null), { base: 'origin/main', compare: 'main' });
});

test('pickDefaultRefs: does not match a same-named branch under a different remote prefix', () => {
  // `origin/mainline` must not be mistaken for `main`'s upstream.
  const branches = [branch('main', false, true), branch('origin/mainline', true), branch('dev')];
  assert.deepEqual(pickDefaultRefs(branches, 'main'), { base: 'dev', compare: 'main' });
});

test('pickDefaultRefs: a single branch has nothing to compare against', () => {
  assert.equal(pickDefaultRefs([branch('main', false, true)], 'main'), null);
});

test('pickDefaultRefs: no branches at all yields null', () => {
  assert.equal(pickDefaultRefs([], null), null);
});

test('pickDefaultRefs: an upstream with no local counterpart still compares', () => {
  const branches = [branch('main', false, true), branch('origin/main', true)];
  assert.deepEqual(pickDefaultRefs(branches, 'main'), { base: 'origin/main', compare: 'main' });
});
