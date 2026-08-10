import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatusPorcelain } from '../../../../src/core/git/parsers';

test('parseStatusPorcelain: counts added, modified and deleted files separately', () => {
  const raw = [' M CHANGELOG.md', ' M README.md', ' D src/old.ts', 'A  src/new.ts', '?? media/icon.svg'].join('\n');
  assert.deepEqual(parseStatusPorcelain(raw), { added: 2, modified: 2, deleted: 1, total: 5 });
});

test('parseStatusPorcelain: an untracked file counts as added', () => {
  assert.deepEqual(parseStatusPorcelain('?? new.txt'), { added: 1, modified: 0, deleted: 0, total: 1 });
});

test('parseStatusPorcelain: a staged-then-modified file is counted once', () => {
  // `AM` = added to the index, modified again in the worktree. One file, not two.
  assert.deepEqual(parseStatusPorcelain('AM src/new.ts'), { added: 1, modified: 0, deleted: 0, total: 1 });
});

test('parseStatusPorcelain: a deletion in either column wins over the other status', () => {
  assert.deepEqual(parseStatusPorcelain(' D gone.ts\nAD staged-then-deleted.ts'), {
    added: 0,
    modified: 0,
    deleted: 2,
    total: 2,
  });
});

test('parseStatusPorcelain: renames, copies and type changes count as modified', () => {
  const raw = ['R  old.ts -> new.ts', 'C  a.ts -> b.ts', 'T  link.ts', 'MM both.ts'].join('\n');
  assert.deepEqual(parseStatusPorcelain(raw), { added: 0, modified: 4, deleted: 0, total: 4 });
});

test('parseStatusPorcelain: a clean tree reports zeroes', () => {
  assert.deepEqual(parseStatusPorcelain(''), { added: 0, modified: 0, deleted: 0, total: 0 });
  assert.deepEqual(parseStatusPorcelain('\n\n'), { added: 0, modified: 0, deleted: 0, total: 0 });
});

test('parseStatusPorcelain: ignores lines too short to carry a status code and a path', () => {
  assert.deepEqual(parseStatusPorcelain(' M\nx\n M a.ts'), { added: 0, modified: 1, deleted: 0, total: 1 });
});
