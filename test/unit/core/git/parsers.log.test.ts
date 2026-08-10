import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';
const RECORD = '\x1e';

function record(fields: string[]): string {
  return fields.join(FIELD) + RECORD;
}

test('parseLog: parses multiple commits, preserving git log order (newest first)', () => {
  const raw =
    record([
      '5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec',
      '5a93a8d',
      'Amy Dev',
      'amy@example.com',
      '2024-02-01T10:00:00+05:30',
      'add line three',
    ]) +
    record([
      '4096af71a8a482397d0a44565e6262b1222986ac',
      '4096af7',
      'Raj Jadon',
      'raj@example.com',
      '2024-01-01T10:00:00+05:30',
      'first commit',
    ]);

  assert.deepEqual(parseLog(raw), [
    {
      sha: '5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec',
      shortSha: '5a93a8d',
      author: 'Amy Dev',
      authorEmail: 'amy@example.com',
      date: '2024-02-01T10:00:00+05:30',
      message: 'add line three',
    },
    {
      sha: '4096af71a8a482397d0a44565e6262b1222986ac',
      shortSha: '4096af7',
      author: 'Raj Jadon',
      authorEmail: 'raj@example.com',
      date: '2024-01-01T10:00:00+05:30',
      message: 'first commit',
    },
  ]);
});

test('parseLog: empty output produces an empty array', () => {
  assert.deepEqual(parseLog(''), []);
});

test('parseLog: a subject line containing tabs and pipes is not mistaken for a delimiter', () => {
  const raw = record([
    'abc123',
    'abc123',
    'Raj Jadon',
    'raj@example.com',
    '2024-01-01T10:00:00+05:30',
    'fix: use a|b or\tc for parsing',
  ]);
  const commits = parseLog(raw);
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.message, 'fix: use a|b or\tc for parsing');
});
