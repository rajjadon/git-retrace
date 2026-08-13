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

test('parseBranches: parses ahead and behind counts from %(upstream:track)', () => {
  const raw = `refs/heads/main${FIELD}*${FIELD}[ahead 2, behind 1]`;
  const [branch] = parseBranches(raw);
  assert.equal(branch?.ahead, 2);
  assert.equal(branch?.behind, 1);
});

test('parseBranches: an ahead-only or behind-only track omits the other field entirely, not as 0 or undefined-but-present', () => {
  const [aheadOnly] = parseBranches(`refs/heads/a${FIELD}${FIELD}[ahead 3]`);
  assert.equal(aheadOnly?.ahead, 3);
  assert.ok(!('behind' in (aheadOnly ?? {})));

  const [behindOnly] = parseBranches(`refs/heads/b${FIELD}${FIELD}[behind 5]`);
  assert.equal(behindOnly?.behind, 5);
  assert.ok(!('ahead' in (behindOnly ?? {})));
});

test('parseBranches: no upstream (empty track, or "[gone]") carries neither ahead nor behind', () => {
  const [noUpstream] = parseBranches(`refs/heads/a${FIELD}${FIELD}`);
  assert.ok(!('ahead' in (noUpstream ?? {})) && !('behind' in (noUpstream ?? {})));

  const [gone] = parseBranches(`refs/heads/b${FIELD}${FIELD}[gone]`);
  assert.ok(!('ahead' in (gone ?? {})) && !('behind' in (gone ?? {})));
});
