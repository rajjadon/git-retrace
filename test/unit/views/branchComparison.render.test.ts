import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBranchComparisonHtml } from '../../../src/views/BranchComparison/render';
import type { Commit, FileChange } from '../../../src/core/git/types';

process.env.TZ = 'UTC';

const now = new Date('2024-02-04T10:00:00Z');
const opts = { nonce: 'abc123', cspSource: 'vscode-webview://xyz', styleUri: 'vscode-webview://xyz/style.css' };

function commit(sha: string, message: string, author: string): Commit {
  return { sha, shortSha: sha.slice(0, 7), author, authorEmail: `${author}@example.com`, date: '2024-02-01T10:00:00Z', message };
}

const files: FileChange[] = [{ path: 'a.ts', insertions: 3, deletions: 1, binary: false }];

test('renderBranchComparisonHtml: shows base/compare heading, ahead/behind counts, commits, files, and diff', () => {
  const html = renderBranchComparisonHtml(
    {
      base: 'main',
      compare: 'feature/x',
      aheadCommits: [commit('deadbeef', 'add feature', 'Amy Dev')],
      behindCommits: [],
      files,
      diff: '+added line\n',
      now,
    },
    opts,
  );
  assert.match(html, /main.*feature\/x/s);
  assert.match(html, /1 commit ahead, 0 commits behind/);
  assert.match(html, /add feature/);
  assert.match(html, /Amy Dev/);
  assert.match(html, /a\.ts/);
  assert.match(html, /\+3/);
  assert.match(html, /class="diff-add">\+added line</);
});

test('renderBranchComparisonHtml: pluralizes ahead/behind counts correctly', () => {
  const html = renderBranchComparisonHtml(
    { base: 'main', compare: 'x', aheadCommits: [], behindCommits: [commit('a', 'm', 'A'), commit('b', 'm', 'A')], files: [], diff: '', now },
    opts,
  );
  assert.match(html, /0 commits ahead, 2 commits behind/);
});

test('renderBranchComparisonHtml: shows "No commits" when a list is empty', () => {
  const html = renderBranchComparisonHtml(
    { base: 'main', compare: 'x', aheadCommits: [], behindCommits: [], files: [], diff: '', now },
    opts,
  );
  assert.match(html, /No commits\./);
});

test('renderBranchComparisonHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const html = renderBranchComparisonHtml(
    { base: 'main', compare: 'x', aheadCommits: [], behindCommits: [], files: [], diff: '', now },
    opts,
  );
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz/);
  assert.ok(!html.includes('unsafe-inline'));
});

test('renderBranchComparisonHtml: escapes HTML special characters in commit-sourced and branch-name fields', () => {
  const html = renderBranchComparisonHtml(
    {
      base: '<b>main</b>',
      compare: 'x',
      aheadCommits: [commit('a', 'fix <script>alert(1)</script>', '<img src=x onerror=alert(1)>')],
      behindCommits: [],
      files: [],
      diff: '',
      now,
    },
    opts,
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('<b>main</b>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderBranchComparisonHtml: each commit row posts openCommit with its sha, no inline handlers', () => {
  const html = renderBranchComparisonHtml(
    { base: 'main', compare: 'x', aheadCommits: [commit('deadbeef', 'm', 'A')], behindCommits: [], files: [], diff: '', now },
    opts,
  );
  assert.match(html, /data-sha="deadbeef"/);
  assert.match(html, /type: 'openCommit'/);
  assert.ok(!html.includes('onclick='));
});
