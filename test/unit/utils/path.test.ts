import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { toRepoRelativePath, buildCacheKey } from '../../../src/utils/path';

test('toRepoRelativePath: strips the repo root and uses forward slashes', () => {
  const repoRoot = ['', 'repo'].join(sep);
  const filePath = ['', 'repo', 'src', 'file.ts'].join(sep);
  assert.equal(toRepoRelativePath(repoRoot, filePath), 'src/file.ts');
});

test('buildCacheKey: joins repoRoot, relative path, and ref', () => {
  const repoRoot = ['', 'repo'].join(sep);
  const filePath = ['', 'repo', 'file.ts'].join(sep);
  assert.equal(buildCacheKey(repoRoot, filePath, 'HEAD'), `${repoRoot}:file.ts:HEAD`);
});
