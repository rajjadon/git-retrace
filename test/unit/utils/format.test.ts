import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlameHover } from '../../../src/utils/format';
import type { BlameLine, FileChange } from '../../../src/core/git/types';

// formatBlameHover renders the absolute date in the local calendar; pin TZ for determinism.
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
  const md = formatBlameHover(entry, diffStat, now);
  assert.match(md, /!\[\]\(https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}\?s=64&d=identicon\)/);
  assert.match(md, /\*\*Amy Dev\*\*/);
  assert.match(md, /add line three/);
  assert.match(md, /3 days ago/);
  assert.match(md, /2024-02-01/);
  assert.match(md, /`5a93a8d`/);
  assert.match(md, /\+3 -1/);
});

test('formatBlameHover: omits the diff stat line when there is none', () => {
  const md = formatBlameHover(entry, null, now);
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: omits the diff stat line for binary files', () => {
  const md = formatBlameHover(entry, { path: 'image.png', insertions: 0, deletions: 0, binary: true }, now);
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: uncommitted lines get a short fixed message, no gravatar', () => {
  const md = formatBlameHover({ ...entry, isUncommitted: true }, null, now);
  assert.match(md, /Uncommitted changes/);
  assert.doesNotMatch(md, /gravatar\.com/);
});

test('formatBlameHover: escapes markdown special characters from git-sourced fields', () => {
  const malicious: BlameLine = {
    ...entry,
    author: '[Evil](http://evil.com)',
    summary: 'click **here** or [here](http://evil.com)',
  };
  const md = formatBlameHover(malicious, null, now);
  // The raw unescaped forms must not appear — they'd render as a live link/emphasis.
  assert.ok(!md.includes('[Evil](http://evil.com)'));
  assert.ok(!md.includes('[here](http://evil.com)'));
  assert.ok(!md.includes('**here**'));
  // The escaped form (a literal backslash before every markdown special char) must appear instead.
  assert.ok(md.includes('\\[Evil\\]\\(http://evil\\.com\\)'));
});

test('formatBlameHover: links an issue reference in the message when issueLinking is provided', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, now, {
    pattern: '#(\\d+)',
    urlTemplate: 'https://github.com/o/r/issues/{issue}',
  });
  // The link text is itself markdown-escaped (consistent with the rest of the message), so
  // the "#" is rendered as "\#" inside the link brackets.
  assert.ok(md.includes('[\\#12](https://github.com/o/r/issues/12)'));
});

test('formatBlameHover: without issueLinking, "#12" is left as escaped plain text, not a link', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, now);
  assert.ok(!md.includes('issues/12'));
  assert.ok(md.includes('\\#12'));
});
