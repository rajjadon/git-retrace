import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGraphLog } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';
const RECORD = '\x1e';

function record(fields: string[]): string {
  return fields.join(FIELD) + RECORD;
}

test('parseGraphLog: parses a merge commit with two parents', () => {
  const raw = record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'A B', '', 'merge feature']);
  const [commit] = parseGraphLog(raw);
  assert.equal(commit?.sha, 'C');
  assert.deepEqual(commit?.parents, ['A', 'B']);
  assert.deepEqual(commit?.refs, []);
});

test('parseGraphLog: a root commit has no parents', () => {
  const raw = record(['Root', 'Root', 'Raj', 'raj@example.com', '2024-01-01T10:00:00+05:30', '', '', 'first commit']);
  const [commit] = parseGraphLog(raw);
  assert.deepEqual(commit?.parents, []);
});

test('parseGraphLog: parses short-form %D decorations, where remote refs are indistinguishable from local ones', () => {
  // Without --decorate=full there is genuinely no way to tell a remote-tracking ref from a local
  // branch literally named "origin/main", so both classify as `branch`. See the --decorate=full
  // case below for the form GitService actually requests.
  const raw = record([
    'C',
    'C',
    'Raj',
    'raj@example.com',
    '2024-03-01T10:00:00+05:30',
    'A',
    'HEAD -> main, origin/main, tag: v1.0.0',
    'release',
  ]);
  const [commit] = parseGraphLog(raw);
  assert.deepEqual(commit?.refs, [
    { name: 'main', type: 'branch', isHead: true },
    { name: 'origin/main', type: 'branch', isHead: false },
    { name: 'v1.0.0', type: 'tag', isHead: false },
  ]);
});

test('parseGraphLog: multiple commits preserve order', () => {
  const raw =
    record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'A B', '', 'merge']) +
    record(['B', 'B', 'Amy', 'amy@example.com', '2024-02-15T10:00:00+05:30', 'Root', '', 'feature work']) +
    record(['A', 'A', 'Raj', 'raj@example.com', '2024-02-01T10:00:00+05:30', 'Root', '', 'main work']);
  const commits = parseGraphLog(raw);
  assert.deepEqual(
    commits.map((c) => c.sha),
    ['C', 'B', 'A'],
  );
});

test('parseGraphLog: empty output produces an empty array', () => {
  assert.deepEqual(parseGraphLog(''), []);
});

test('parseGraphLog: with --decorate=full, tells local branches, remote branches and tags apart', () => {
  const raw = record([
    'C',
    'C',
    'Raj',
    'raj@example.com',
    '2024-03-01T10:00:00+05:30',
    'A',
    'HEAD -> refs/heads/master, refs/remotes/origin/master, tag: refs/tags/v1.0.0, refs/heads/wip',
    'release',
  ]);
  const [commit] = parseGraphLog(raw);
  assert.deepEqual(commit?.refs, [
    { name: 'master', type: 'branch', isHead: true },
    { name: 'origin/master', type: 'remoteBranch', isHead: false },
    { name: 'v1.0.0', type: 'tag', isHead: false },
    { name: 'wip', type: 'branch', isHead: false },
  ]);
});

test('parseGraphLog: a detached HEAD is flagged as the head ref', () => {
  const raw = record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'A', 'HEAD', 'wip']);
  const [commit] = parseGraphLog(raw);
  assert.deepEqual(commit?.refs, [{ name: 'HEAD', type: 'detached', isHead: true }]);
});

test('parseGraphLog: folds each commit\'s --numstat block into its own diff stat, not the next commit\'s', () => {
  // Regression guard: git prints the stat block *after* the formatted record, so splitting on the
  // record separator alone attaches every block to the wrong commit (off by one).
  const raw =
    record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'B', '', 'newest']) +
    '\n\n1\t0\ta.txt\n2\t3\tb.txt\n' +
    record(['B', 'B', 'Amy', 'amy@example.com', '2024-02-15T10:00:00+05:30', 'A', '', 'middle']) +
    '\n\n4\t1\tc.txt\n' +
    record(['A', 'A', 'Raj', 'raj@example.com', '2024-02-01T10:00:00+05:30', '', '', 'root']) +
    '\n\n7\t0\td.txt\n';
  const commits = parseGraphLog(raw);
  assert.deepEqual(
    commits.map((c) => [c.sha, c.filesChanged, c.insertions, c.deletions]),
    [
      ['C', 2, 3, 3],
      ['B', 1, 4, 1],
      ['A', 1, 7, 0],
    ],
  );
});

test('parseGraphLog: a binary file counts toward filesChanged but contributes no lines', () => {
  const raw =
    record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'A', '', 'add logo']) +
    '\n\n-\t-\tlogo.png\n3\t1\tREADME.md\n';
  const [commit] = parseGraphLog(raw);
  assert.equal(commit?.filesChanged, 2);
  assert.equal(commit?.insertions, 3);
  assert.equal(commit?.deletions, 1);
});

test('parseGraphLog: a merge commit gets no numstat block and reports a zero stat', () => {
  const raw =
    record(['M', 'M', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'A B', '', 'merge branch']) +
    '\n' +
    record(['A', 'A', 'Raj', 'raj@example.com', '2024-02-01T10:00:00+05:30', '', '', 'root']) +
    '\n\n2\t0\ta.txt\n';
  const commits = parseGraphLog(raw);
  assert.equal(commits[0]?.sha, 'M');
  assert.equal(commits[0]?.filesChanged, 0);
  assert.equal(commits[1]?.filesChanged, 1);
});

test('parseGraphLog: a stat block before any commit record is discarded, not crashed on', () => {
  assert.deepEqual(parseGraphLog('1\t2\torphan.txt\n'), []);
});
