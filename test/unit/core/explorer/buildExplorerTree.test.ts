import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExplorerSections } from '../../../../src/core/explorer/buildExplorerTree';
import type { ExplorerData } from '../../../../src/core/explorer/buildExplorerTree';

const empty: ExplorerData = { branches: [], remotes: [], tags: [], stashes: [], worktrees: [], contributors: [] };

test('buildExplorerSections: always returns exactly six sections, in a fixed order', () => {
  const sections = buildExplorerSections(empty);
  assert.deepEqual(
    sections.map((s) => s.label),
    ['Branches', 'Remotes', 'Tags', 'Stashes', 'Worktrees', 'Contributors'],
  );
});

test('buildExplorerSections: an empty repo produces six sections with zero children each', () => {
  const sections = buildExplorerSections(empty);
  for (const section of sections) {
    assert.deepEqual(section.children, []);
  }
});

test('buildExplorerSections: wraps each branch as a branch node under the Branches section', () => {
  const data: ExplorerData = {
    ...empty,
    branches: [
      { name: 'main', isRemote: false, isCurrent: true },
      { name: 'origin/main', isRemote: true, isCurrent: false },
    ],
  };
  const [branchesSection] = buildExplorerSections(data);
  assert.equal(branchesSection?.children.length, 2);
  assert.deepEqual(branchesSection?.children[0], { kind: 'branch', branch: data.branches[0] });
  assert.deepEqual(branchesSection?.children[1], { kind: 'branch', branch: data.branches[1] });
});

test('buildExplorerSections: wraps remotes, tags, stashes, worktrees, and contributors under their own sections', () => {
  const data: ExplorerData = {
    branches: [],
    remotes: [{ name: 'origin', url: 'https://github.com/x/y.git' }],
    tags: [{ name: 'v1.0.0' }],
    stashes: [{ index: 0, message: 'WIP', baseSha: 'a1b2c3d' }],
    worktrees: [{ path: '/repo', branch: 'main', isMain: true }],
    contributors: [{ name: 'Raj', email: 'raj@example.com', commitCount: 10 }],
  };
  const [, remotesSection, tagsSection, stashesSection, worktreesSection, contributorsSection] = buildExplorerSections(data);
  assert.deepEqual(remotesSection?.children, [{ kind: 'remote', remote: data.remotes[0] }]);
  assert.deepEqual(tagsSection?.children, [{ kind: 'tag', tag: data.tags[0] }]);
  assert.deepEqual(stashesSection?.children, [{ kind: 'stash', stash: data.stashes[0] }]);
  assert.deepEqual(worktreesSection?.children, [{ kind: 'worktree', worktree: data.worktrees[0] }]);
  assert.deepEqual(contributorsSection?.children, [{ kind: 'contributor', contributor: data.contributors[0] }]);
});

test('buildExplorerSections: each section has a stable, distinct id (used as the TreeItem id)', () => {
  const sections = buildExplorerSections(empty);
  const ids = sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'expected all section ids to be unique');
});
