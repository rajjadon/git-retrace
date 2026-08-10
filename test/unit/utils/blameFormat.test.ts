import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlameLabel } from '../../../src/utils/blameFormat';

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
