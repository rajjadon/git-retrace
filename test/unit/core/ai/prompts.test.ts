import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommitSummaryPrompt } from '../../../../src/core/ai/prompts';
import type { CommitDetail } from '../../../../src/core/git/types';

const commit: CommitDetail = {
  sha: 'abc123',
  shortSha: 'abc123',
  author: 'Amy Dev',
  authorEmail: 'amy@example.com',
  date: '2024-02-01T10:00:00Z',
  message: 'fix: handle empty repo',
  body: 'fix: handle empty repo\n\nThis also fixes a crash when HEAD is unborn.',
};

test('buildCommitSummaryPrompt: includes the full commit body and the diff', () => {
  const diff = '+line three\n-line two\n';
  const prompt = buildCommitSummaryPrompt(commit, diff, 8000);
  assert.match(prompt, /This also fixes a crash when HEAD is unborn\./);
  assert.match(prompt, /\+line three/);
});

test('buildCommitSummaryPrompt: passes a diff under the limit through unchanged', () => {
  const diff = 'short diff';
  const prompt = buildCommitSummaryPrompt(commit, diff, 8000);
  assert.match(prompt, /short diff/);
  assert.ok(!prompt.includes('[...truncated]'));
});

test('buildCommitSummaryPrompt: truncates a diff over the limit and marks it', () => {
  const diff = 'a'.repeat(20);
  const prompt = buildCommitSummaryPrompt(commit, diff, 10);
  assert.match(prompt, /a{10}\[\.\.\.truncated\]/);
  assert.ok(!prompt.includes('a'.repeat(11)));
});

test('buildCommitSummaryPrompt: handles an empty diff (e.g. a merge commit)', () => {
  const prompt = buildCommitSummaryPrompt(commit, '', 8000);
  assert.match(prompt, /fix: handle empty repo/);
});
