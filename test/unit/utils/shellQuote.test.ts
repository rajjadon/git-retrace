import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellQuotePosix } from '../../../src/utils/shellQuote';

test('shellQuotePosix: wraps a plain value in single quotes', () => {
  assert.equal(shellQuotePosix('main'), "'main'");
});

test('shellQuotePosix: escapes an embedded single quote so it round-trips as a literal character', () => {
  assert.equal(shellQuotePosix("feature/o'brien"), "'feature/o'\\''brien'");
});

test('shellQuotePosix: neutralizes shell metacharacters — they stay literal text, never executed', () => {
  // A branch name is user/repo-controlled content, not a trusted command fragment. Anything that
  // would otherwise end the quoted string and inject a new command must be defused.
  const malicious = "main'; rm -rf ~ #";
  const quoted = shellQuotePosix(malicious);
  // The only single quotes in the output are the escape sequence's own — none of them closes the
  // outer quoting early and leaves `; rm -rf ~ #` outside of it.
  assert.equal(quoted, "'main'\\''; rm -rf ~ #'");
});

test('shellQuotePosix: an empty string quotes to an empty pair of quotes', () => {
  assert.equal(shellQuotePosix(''), "''");
});
