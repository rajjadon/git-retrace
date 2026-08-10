import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlameLabel, formatBlameEntry } from '../../../src/utils/blameFormat';
import type { BlameLine } from '../../../src/core/git/types';

process.env.TZ = 'UTC';

const ctx = {
  author: 'Raj Jadon',
  age: '3 days ago',
  date: '2024-02-01',
  message: 'add line three',
  sha: '83f986b',
};

test('formatBlameLabel: substitutes known tokens', () => {
  assert.equal(formatBlameLabel('{author}, {age}', ctx), 'Raj Jadon, 3 days ago');
});

test('formatBlameLabel: substitutes all token types', () => {
  assert.equal(
    formatBlameLabel('{author}|{age}|{date}|{message}|{sha}', ctx),
    'Raj Jadon|3 days ago|2024-02-01|add line three|83f986b',
  );
});

test('formatBlameLabel: unknown tokens pass through unchanged', () => {
  assert.equal(formatBlameLabel('{author} ({unknown})', ctx), 'Raj Jadon ({unknown})');
});

test('formatBlameLabel: template with no tokens returns itself', () => {
  assert.equal(formatBlameLabel('static text', ctx), 'static text');
});

const now = new Date('2024-02-04T10:00:00Z');

const entry: BlameLine = {
  line: 2,
  sha: '5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec',
  author: 'Amy Dev',
  authorEmail: 'amy@example.com',
  authorTime: Math.floor(new Date('2024-02-01T10:00:00Z').getTime() / 1000),
  summary: 'add line three',
  isUncommitted: false,
};

test('formatBlameEntry: formats a committed line per the template', () => {
  assert.equal(formatBlameEntry(entry, '{author}, {age}', now), 'Amy Dev, 3 days ago');
});

test('formatBlameEntry: substitutes sha and date tokens', () => {
  assert.equal(formatBlameEntry(entry, '{sha} on {date}', now), '5a93a8d on 2024-02-01');
});

test('formatBlameEntry: uncommitted lines render as "You, uncommitted"', () => {
  assert.equal(formatBlameEntry({ ...entry, isUncommitted: true }, '{author}, {age}', now), 'You, uncommitted');
});
