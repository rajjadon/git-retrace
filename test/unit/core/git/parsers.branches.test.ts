import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranches } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';

function line(refname: string, isHead: boolean): string {
  return `${refname}${FIELD}${isHead ? '*' : ''}`;
}

test('parseBranches: distinguishes local from remote branches by refname prefix', () => {
  const raw = [line('refs/heads/main', true), line('refs/remotes/origin/main', false)].join('\n');
  assert.deepEqual(parseBranches(raw), [
    { name: 'main', isRemote: false, isCurrent: true },
    { name: 'origin/main', isRemote: true, isCurrent: false },
  ]);
});

test('parseBranches: filters out the origin/HEAD symbolic alias', () => {
  const raw = [line('refs/remotes/origin/HEAD', false), line('refs/remotes/origin/main', false)].join('\n');
  const branches = parseBranches(raw);
  assert.equal(branches.length, 1);
  assert.equal(branches[0]?.name, 'origin/main');
});

test('parseBranches: handles branch names containing slashes', () => {
  const raw = line('refs/heads/feature/add-graph', false);
  const [branch] = parseBranches(raw);
  assert.equal(branch?.name, 'feature/add-graph');
  assert.equal(branch?.isRemote, false);
});

test('parseBranches: empty output produces an empty array', () => {
  assert.deepEqual(parseBranches(''), []);
});
