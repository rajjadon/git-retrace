import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContributors } from '../../../../src/core/git/parsers';

test('parseContributors: parses commit count, name, and email per line', () => {
  const raw = '    42\tRaj Jadon <raj@example.com>\n     3\tAnita K. <anita@example.com>\n';
  assert.deepEqual(parseContributors(raw), [
    { commitCount: 42, name: 'Raj Jadon', email: 'raj@example.com' },
    { commitCount: 3, name: 'Anita K.', email: 'anita@example.com' },
  ]);
});

test('parseContributors: empty output produces an empty array', () => {
  assert.deepEqual(parseContributors(''), []);
});
