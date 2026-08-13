import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileHistoryLog } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';
const RECORD = '\x1e';

function record(fields: string[]): string {
  return fields.join(FIELD) + RECORD;
}

test('parseFileHistoryLog: parses a single commit with its stat line', () => {
  const raw = record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'fix mime type']) + '\n\n4\t3\tsrc/pdfBase64.ts\n';
  const [entry] = parseFileHistoryLog(raw);
  assert.equal(entry?.sha, 'C');
  assert.equal(entry?.author, 'Raj');
  assert.equal(entry?.insertions, 4);
  assert.equal(entry?.deletions, 3);
});

test('parseFileHistoryLog: multiple commits preserve newest-first order, each keeping its own stat', () => {
  const raw =
    record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'newest']) +
    '\n\n1\t0\ta.txt\n' +
    record(['B', 'B', 'Amy', 'amy@example.com', '2024-02-15T10:00:00+05:30', 'middle']) +
    '\n\n2\t3\ta.txt\n' +
    record(['A', 'A', 'Raj', 'raj@example.com', '2024-02-01T10:00:00+05:30', 'root']) +
    '\n\n7\t0\ta.txt\n';
  const entries = parseFileHistoryLog(raw);
  assert.deepEqual(
    entries.map((e) => [e.sha, e.insertions, e.deletions]),
    [
      ['C', 1, 0],
      ['B', 2, 3],
      ['A', 7, 0],
    ],
  );
});

test('parseFileHistoryLog: a binary file reports zero insertions and deletions, not NaN', () => {
  const raw = record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'add logo']) + '\n\n-\t-\tlogo.png\n';
  const [entry] = parseFileHistoryLog(raw);
  assert.equal(entry?.insertions, 0);
  assert.equal(entry?.deletions, 0);
});

test('parseFileHistoryLog: a commit with no stat line (e.g. a pure rename) reports a zero stat', () => {
  const raw =
    record(['C', 'C', 'Raj', 'raj@example.com', '2024-03-01T10:00:00+05:30', 'rename only']) +
    '\n' +
    record(['B', 'B', 'Raj', 'raj@example.com', '2024-02-01T10:00:00+05:30', 'root']) +
    '\n\n2\t0\ta.txt\n';
  const entries = parseFileHistoryLog(raw);
  assert.equal(entries[0]?.sha, 'C');
  assert.equal(entries[0]?.insertions, 0);
  assert.equal(entries[0]?.deletions, 0);
  assert.equal(entries[1]?.insertions, 2);
});

test('parseFileHistoryLog: empty output produces an empty array', () => {
  assert.deepEqual(parseFileHistoryLog(''), []);
});
