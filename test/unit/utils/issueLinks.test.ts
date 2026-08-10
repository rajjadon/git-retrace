import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkifyIssues, buildDefaultUrlTemplate } from '../../../src/utils/issueLinks';

test('linkifyIssues: links a single issue reference in the middle of text', () => {
  const segments = linkifyIssues('fix #12 crash', '#(\\d+)', 'https://github.com/o/r/issues/{issue}');
  assert.deepEqual(segments, [
    { text: 'fix ', url: null },
    { text: '#12', url: 'https://github.com/o/r/issues/12' },
    { text: ' crash', url: null },
  ]);
});

test('linkifyIssues: links multiple references', () => {
  const segments = linkifyIssues('fixes #1 and #2', '#(\\d+)', 'https://x/{issue}');
  const links = segments.filter((s) => s.url !== null);
  assert.deepEqual(
    links.map((s) => s.url),
    ['https://x/1', 'https://x/2'],
  );
});

test('linkifyIssues: no matches returns the whole text as one plain segment', () => {
  assert.deepEqual(linkifyIssues('no references here', '#(\\d+)', 'https://x/{issue}'), [
    { text: 'no references here', url: null },
  ]);
});

test('linkifyIssues: falls back to plain text for an invalid regex pattern', () => {
  assert.deepEqual(linkifyIssues('fix #12', '(unterminated', 'https://x/{issue}'), [
    { text: 'fix #12', url: null },
  ]);
});

test('linkifyIssues: uses the whole match when the pattern has no capture group', () => {
  const segments = linkifyIssues('ABC-123 fixed', 'ABC-\\d+', 'https://jira/{issue}');
  const link = segments.find((s) => s.url !== null);
  assert.equal(link?.url, 'https://jira/ABC-123');
});

test('buildDefaultUrlTemplate: GitHub-style path', () => {
  assert.equal(
    buildDefaultUrlTemplate({ host: 'github.com', owner: 'rajjadon', repo: 'gitSense' }),
    'https://github.com/rajjadon/gitSense/issues/{issue}',
  );
});

test('buildDefaultUrlTemplate: GitLab-style path with nested group', () => {
  assert.equal(
    buildDefaultUrlTemplate({ host: 'gitlab.com', owner: 'group/subgroup', repo: 'repo' }),
    'https://gitlab.com/group/subgroup/repo/-/issues/{issue}',
  );
});
