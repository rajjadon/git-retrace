// test/unit/utils/format.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlameHover } from '../../../src/utils/format';
import type { BlameLine, FileChange } from '../../../src/core/git/types';
import type { LineExplanationState } from '../../../src/core/ai/lineExplanationKey';

process.env.TZ = 'UTC';

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

const diffStat: FileChange = { path: 'tracked.txt', insertions: 3, deletions: 1, binary: false };

test('formatBlameHover: includes gravatar, author, message, age, date, sha, and diff stat', () => {
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', undefined, now);
  assert.match(md, /!\[\]\(https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}\?s=20&d=identicon\)/);
  assert.match(md, /\*\*Amy Dev\*\*/);
  assert.match(md, /add line three/);
  assert.match(md, /3 days ago/);
  assert.match(md, /2024-02-01/);
  assert.match(md, /`5a93a8d`/);
  assert.match(md, /\+3 -1/);
});

test('formatBlameHover: omits the diff stat line when there is none', () => {
  const md = formatBlameHover(entry, null, 'tracked.txt', 'line three', undefined, now);
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: omits the diff stat line for binary files', () => {
  const md = formatBlameHover(
    entry,
    { path: 'image.png', insertions: 0, deletions: 0, binary: true },
    'image.png',
    'line three',
    undefined,
    now,
  );
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: uncommitted lines get a short fixed message, no gravatar, no AI link', () => {
  const md = formatBlameHover({ ...entry, isUncommitted: true }, null, 'tracked.txt', 'line three', undefined, now);
  assert.match(md, /Uncommitted changes/);
  assert.doesNotMatch(md, /gravatar\.com/);
  assert.ok(!md.includes('command:gitLore.explainLine'));
});

test('formatBlameHover: escapes markdown special characters from git-sourced fields', () => {
  const malicious: BlameLine = {
    ...entry,
    author: '[Evil](http://evil.com)',
    summary: 'click **here** or [here](http://evil.com)',
  };
  const md = formatBlameHover(malicious, null, 'tracked.txt', 'line three', undefined, now);
  assert.ok(!md.includes('[Evil](http://evil.com)'));
  assert.ok(!md.includes('[here](http://evil.com)'));
  assert.ok(!md.includes('**here**'));
  assert.ok(md.includes('\\[Evil\\]\\(http://evil\\.com\\)'));
});

test('formatBlameHover: links an issue reference in the message when issueLinking is provided', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, 'tracked.txt', 'line three', undefined, now, {
    pattern: '#(\\d+)',
    urlTemplate: 'https://github.com/o/r/issues/{issue}',
  });
  assert.ok(md.includes('[\\#12](https://github.com/o/r/issues/12)'));
});

test('formatBlameHover: without issueLinking, "#12" is left as escaped plain text, not a link', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, 'tracked.txt', 'line three', undefined, now);
  assert.ok(!md.includes('issues/12'));
  assert.ok(md.includes('\\#12'));
});

test('formatBlameHover: with no line-explanation state, shows the Explain this line link with sparkle icon', () => {
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', undefined, now);
  assert.match(md, /\[\$\(sparkle\) Explain this line\]\(command:gitLore\.explainLine\?/);
  const match = /command:gitLore\.explainLine\?(\S+)\)/.exec(md);
  assert.ok(match, 'expected an encoded command link');
  const args = JSON.parse(decodeURIComponent(match[1] ?? '')) as unknown[];
  assert.deepEqual(args, ['tracked.txt', entry.sha, 'line three']);
});

test('formatBlameHover: pending state shows a generating notice, no link', () => {
  const state: LineExplanationState = { status: 'pending' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /Generating explanation/);
  assert.ok(!md.includes('command:gitLore.explainLine'));
});

test('formatBlameHover: done state shows the explanation text, no link', () => {
  const state: LineExplanationState = { status: 'done', text: 'This line guards against an unborn HEAD.' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /Why this line exists/);
  // Trailing "." is markdown-escaped by the 'done' branch (see the dedicated escaping test
  // below), so this only asserts the unescaped text content, not exact punctuation.
  assert.match(md, /This line guards against an unborn HEAD/);
  assert.ok(!md.includes('command:gitLore.explainLine'));
});

test('formatBlameHover: done state escapes markdown special characters in the model output', () => {
  const state: LineExplanationState = { status: 'done', text: 'Uses [a link](http://evil.com) and **bold**.' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.ok(!md.includes('[a link](http://evil.com)'));
  assert.ok(!md.includes('**bold**'));
});

test('formatBlameHover: noModel state shows the hint and a retry link', () => {
  const state: LineExplanationState = { status: 'noModel' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /No language model available/);
  assert.match(md, /\[\$\(sparkle\) Explain this line\]\(command:gitLore\.explainLine\?/);
});

test('formatBlameHover: error state shows the message and a retry link', () => {
  const state: LineExplanationState = { status: 'error', message: 'network timeout' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /Failed to generate explanation: network timeout/);
  assert.match(md, /\[\$\(sparkle\) Explain this line\]\(command:gitLore\.explainLine\?/);
});

test('formatBlameHover: every render path ends with a trailing --- divider', () => {
  const endsWithDivider = (md: string) => md.trimEnd().endsWith('---');

  // committed, no explanation state
  assert.ok(endsWithDivider(formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', undefined, now)));
  // uncommitted early-return path
  assert.ok(endsWithDivider(formatBlameHover({ ...entry, isUncommitted: true }, null, 'tracked.txt', 'line three', undefined, now)));
  // pending
  assert.ok(endsWithDivider(formatBlameHover(entry, null, 'tracked.txt', 'line three', { status: 'pending' }, now)));
  // done
  assert.ok(endsWithDivider(formatBlameHover(entry, null, 'tracked.txt', 'line three', { status: 'done', text: 'short' }, now)));
  // noModel
  assert.ok(endsWithDivider(formatBlameHover(entry, null, 'tracked.txt', 'line three', { status: 'noModel' }, now)));
  // error
  assert.ok(endsWithDivider(formatBlameHover(entry, null, 'tracked.txt', 'line three', { status: 'error', message: 'oops' }, now)));
});

test('formatBlameHover: done state truncates explanations over MAX_EXPLANATION_CHARS with a trailing ellipsis', () => {
  const long = 'a'.repeat(501);
  const state: LineExplanationState = { status: 'done', text: long };
  const md = formatBlameHover(entry, null, 'tracked.txt', 'line three', state, now);
  // Must end with '…' (before the trailing ---)
  assert.ok(md.includes('a'.repeat(500) + '…'), 'expected truncation at 500 chars');
  assert.ok(!md.includes('a'.repeat(501)), 'expected the 501st char to be cut');
});

test('formatBlameHover: done state does not truncate explanations at or under MAX_EXPLANATION_CHARS', () => {
  const atLimit = 'b'.repeat(500);
  const state: LineExplanationState = { status: 'done', text: atLimit };
  const md = formatBlameHover(entry, null, 'tracked.txt', 'line three', state, now);
  assert.ok(md.includes('b'.repeat(500)), 'expected full text preserved');
  assert.ok(!md.includes('…'), 'expected no ellipsis when text is exactly at the limit');
});

test('formatBlameHover: diffstat includes "in this file" scope label', () => {
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', undefined, now);
  assert.match(md, /in this file/);
  assert.match(md, /\$\(diff\)/);
});
