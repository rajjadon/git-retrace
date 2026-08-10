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

test('parseGraphLog: parses ref decorations — HEAD branch, remote branch, and tag', () => {
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
    { name: 'main', type: 'branch' },
    { name: 'origin/main', type: 'branch' },
    { name: 'v1.0.0', type: 'tag' },
  ]);
});

test('parseGraphLog: detached HEAD with no branch', () => {
  const raw = record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'A', 'HEAD', 'wip']);
  const [commit] = parseGraphLog(raw);
  assert.deepEqual(commit?.refs, [{ name: 'HEAD', type: 'detached' }]);
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
