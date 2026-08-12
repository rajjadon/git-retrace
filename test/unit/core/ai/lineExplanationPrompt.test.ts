import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineExplanationPrompt } from '../../../../src/core/ai/prompts';
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

test('buildLineExplanationPrompt: includes the line content, commit body, and diff', () => {
  const prompt = buildLineExplanationPrompt(commit, '+line three\n-line two\n', 'line three', 8000);
  assert.match(prompt, /line three/);
  assert.match(prompt, /This also fixes a crash when HEAD is unborn\./);
  assert.match(prompt, /\+line three/);
});

test('buildLineExplanationPrompt: passes a diff under the limit through unchanged', () => {
  const prompt = buildLineExplanationPrompt(commit, 'short diff', 'x', 8000);
  assert.match(prompt, /short diff/);
  assert.ok(!prompt.includes('[...truncated]'));
});

test('buildLineExplanationPrompt: truncates a diff over the limit and marks it', () => {
  const diff = 'a'.repeat(20);
  const prompt = buildLineExplanationPrompt(commit, diff, 'x', 10);
  assert.match(prompt, /a{10}\[\.\.\.truncated\]/);
  assert.ok(!prompt.includes('a'.repeat(11)));
});

test('buildLineExplanationPrompt: handles an empty diff', () => {
  const prompt = buildLineExplanationPrompt(commit, '', 'line three', 8000);
  assert.match(prompt, /fix: handle empty repo/);
  assert.match(prompt, /line three/);
});
