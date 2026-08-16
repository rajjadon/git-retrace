import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCoChangedFiles } from '../../../../src/core/git/coChange';
import type { CommitFileList } from '../../../../src/core/git/types';

function commits(...fileLists: string[][]): CommitFileList[] {
  return fileLists.map((files, i) => ({ sha: `sha${i}`, files }));
}

test('computeCoChangedFiles: ranks a consistently co-changed file above an occasional one', () => {
  const result = computeCoChangedFiles(
    commits(
      ['src/a.ts', 'src/a.test.ts'],
      ['src/a.ts', 'src/a.test.ts'],
      ['src/a.ts', 'src/a.test.ts'],
      ['src/a.ts', 'src/unrelated.ts'],
    ),
    'src/a.ts',
  );
  assert.deepEqual(result, [{ path: 'src/a.test.ts', coChanges: 3, totalCommits: 4, coupling: 0.75 }]);
});

test('computeCoChangedFiles: drops candidates below the minimum coupling ratio', () => {
  // b.ts rides along in only 1 of 4 commits touching a.ts — 25%, under the 30% floor.
  const result = computeCoChangedFiles(
    commits(['src/a.ts', 'src/b.ts'], ['src/a.ts'], ['src/a.ts'], ['src/a.ts']),
    'src/a.ts',
  );
  assert.deepEqual(result, []);
});

test('computeCoChangedFiles: drops a single coincidental shared commit even at 100% coupling', () => {
  const result = computeCoChangedFiles(commits(['src/a.ts', 'src/b.ts']), 'src/a.ts');
  assert.deepEqual(result, []);
});

test('computeCoChangedFiles: a file with no history in the window returns no results', () => {
  assert.deepEqual(computeCoChangedFiles(commits(['src/other.ts']), 'src/a.ts'), []);
});

test('computeCoChangedFiles: caps results at the given limit, highest coupling first', () => {
  const result = computeCoChangedFiles(
    commits(
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      ['src/a.ts', 'src/b.ts'],
    ),
    'src/a.ts',
    2,
  );
  assert.equal(result.length, 2);
  assert.equal(result[0]?.path, 'src/b.ts');
  assert.equal(result[0]?.coupling, 1);
});
