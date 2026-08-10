import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommitDetail } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';

function raw(fields: string[], body: string): string {
  return fields.join(FIELD) + FIELD + body;
}

test('parseCommitDetail: parses a single-line message (subject only, no body)', () => {
  const input = raw(
    ['5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec', '5a93a8d', 'Amy Dev', 'amy@example.com', '2024-02-01T10:00:00+05:30'],
    'add line three\n',
  );
  assert.deepEqual(parseCommitDetail(input), {
    sha: '5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec',
    shortSha: '5a93a8d',
    author: 'Amy Dev',
    authorEmail: 'amy@example.com',
    date: '2024-02-01T10:00:00+05:30',
    message: 'add line three',
    body: 'add line three',
  });
});

test('parseCommitDetail: preserves a multi-line body, splitting only message (first line) from body (all lines)', () => {
  const fullBody = 'fix: handle empty repo\n\nThis also fixes a crash when HEAD is unborn.\n\nFixes #42';
  const input = raw(['abc123', 'abc123', 'Raj Jadon', 'raj@example.com', '2024-03-01T10:00:00+05:30'], `${fullBody}\n`);
  const result = parseCommitDetail(input);
  assert.equal(result?.message, 'fix: handle empty repo');
  assert.equal(result?.body, fullBody);
});

test('parseCommitDetail: malformed input (too few fields) returns null', () => {
  assert.equal(parseCommitDetail('abc123\x1fonly-two-fields'), null);
});

test('parseCommitDetail: empty input returns null', () => {
  assert.equal(parseCommitDetail(''), null);
});
