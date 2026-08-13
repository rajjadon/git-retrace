import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRebaseTodo, serializeRebaseTodo } from '../../../../src/core/git/rebaseTodo';

// A real git-rebase-todo, as git itself writes it: commands, then its own help-text comments.
const REAL_TODO = `pick a1b2c3d first commit
squash 4e5f6a7 fixup typo
pick 8b9c0d1 second commit

# Rebase 0000000..8b9c0d1 onto 0000000 (3 commands)
#
# Commands:
# p, pick <commit> = use commit
# r, reword <commit> = use commit, but edit the commit message
# e, edit <commit> = use commit, but stop for amending
# s, squash <commit> = use commit, but meld into previous commit
# f, fixup [-C | -c] <commit> = like "squash" ...
# x, exec <command> = run command (the rest of the line) using shell
# b, break = stop here (continue rebase later with 'git rebase --continue')
# d, drop <commit> = remove commit
# l, label <label> = label current HEAD with a name
# t, reset <label> = reset HEAD to a label
# m, merge [-C <commit> | -c <commit>] <label> [# <oneline>] = create a merge commit ...
#
# These lines can be re-ordered; they are executed from top to bottom.
#
# If you remove a line here THAT COMMIT WILL BE LOST.
#
# However, if you remove everything, the rebase will be aborted.
#
# Note that empty commits are commented out
`;

test('parseRebaseTodo: parses pick/squash commands into editable entries', () => {
  const entries = parseRebaseTodo(REAL_TODO);
  assert.deepEqual(
    entries.map((e) => ({ editable: e.editable, command: e.command, sha: e.sha, message: e.message })),
    [
      { editable: true, command: 'pick', sha: 'a1b2c3d', message: 'first commit' },
      { editable: true, command: 'squash', sha: '4e5f6a7', message: 'fixup typo' },
      { editable: true, command: 'pick', sha: '8b9c0d1', message: 'second commit' },
    ],
  );
});

test('parseRebaseTodo: strips comment lines and blank lines, keeping only commands', () => {
  const entries = parseRebaseTodo(REAL_TODO);
  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => !e.raw.trim().startsWith('#')));
});

test('parseRebaseTodo: normalizes single-letter command abbreviations to their full word', () => {
  const entries = parseRebaseTodo('p a1b2c3d one\nf 4e5f6a7 two\nd 8b9c0d1 three\n');
  assert.deepEqual(
    entries.map((e) => e.command),
    ['pick', 'fixup', 'drop'],
  );
});

test('parseRebaseTodo: a line this editor cannot safely reorder (exec/label/merge/break) is kept as a non-editable, verbatim entry — never dropped', () => {
  const raw = 'pick a1b2c3d one\nexec npm test\nlabel onto\npick 4e5f6a7 two\n';
  const entries = parseRebaseTodo(raw);
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((e) => e.editable),
    [true, false, false, true],
  );
  assert.equal(entries[1]?.raw, 'exec npm test');
  assert.equal(entries[2]?.raw, 'label onto');
});

test('parseRebaseTodo: empty input produces an empty array', () => {
  assert.deepEqual(parseRebaseTodo(''), []);
});

test('serializeRebaseTodo: reconstructs command lines from editable entries', () => {
  const out = serializeRebaseTodo([
    { editable: true, command: 'pick', sha: 'a1b2c3d', message: 'first commit', raw: 'pick a1b2c3d first commit' },
    { editable: true, command: 'drop', sha: '4e5f6a7', message: 'fixup typo', raw: 'squash 4e5f6a7 fixup typo' },
  ]);
  assert.equal(out, 'pick a1b2c3d first commit\ndrop 4e5f6a7 fixup typo\n');
});

test('serializeRebaseTodo: a non-editable entry is written back verbatim, not reconstructed', () => {
  const out = serializeRebaseTodo([
    { editable: false, command: '', sha: '', message: '', raw: 'exec npm test' },
    { editable: true, command: 'pick', sha: 'a1b2c3d', message: 'one', raw: 'pick a1b2c3d one' },
  ]);
  assert.equal(out, 'exec npm test\npick a1b2c3d one\n');
});

test('serializeRebaseTodo: reordering the array is reflected in the output order', () => {
  const a = { editable: true, command: 'pick', sha: 'aaaaaaa', message: 'A', raw: 'pick aaaaaaa A' };
  const b = { editable: true, command: 'pick', sha: 'bbbbbbb', message: 'B', raw: 'pick bbbbbbb B' };
  assert.equal(serializeRebaseTodo([b, a]), 'pick bbbbbbb B\npick aaaaaaa A\n');
});

test('serializeRebaseTodo: an empty entry list produces an empty document, matching git\'s own "nothing to do, abort" convention', () => {
  assert.equal(serializeRebaseTodo([]), '');
});

test('parseRebaseTodo -> serializeRebaseTodo round-trips an untouched real todo file into an equivalent, parseable document', () => {
  const entries = parseRebaseTodo(REAL_TODO);
  const out = serializeRebaseTodo(entries);
  const reparsed = parseRebaseTodo(out);
  assert.deepEqual(reparsed, entries);
});
