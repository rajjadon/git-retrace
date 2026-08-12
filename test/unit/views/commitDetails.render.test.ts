import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCommitDetailsHtml } from '../../../src/views/CommitDetails/render';
import type { CommitDetail, FileChange } from '../../../src/core/git/types';

process.env.TZ = 'UTC';

const now = new Date('2024-02-04T10:00:00Z');

const commit: CommitDetail = {
  sha: '5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec',
  shortSha: '5a93a8d',
  author: 'Amy Dev',
  authorEmail: 'amy@example.com',
  date: '2024-02-01T10:00:00Z',
  message: 'add line three',
  body: 'add line three',
};

const files: FileChange[] = [{ path: 'tracked.txt', insertions: 1, deletions: 0, binary: false }];
const diff = 'diff --git a/tracked.txt b/tracked.txt\n@@ -1,2 +1,3 @@\n line one\n line two\n+line three\n';

const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/commitDetails.css'],
  editorFontFamily: 'Menlo',
};

test('renderCommitDetailsHtml: includes commit metadata, files, and diff', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /<h1 title="add line three">add line three<\/h1>/);
  assert.match(html, /Amy Dev/);
  assert.match(html, /5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec/);
  assert.match(html, /tracked\.txt/);
  assert.match(html, /\+1/);
  assert.match(html, /class="dc diff-add">\+line three</);
  assert.match(html, /class="dc diff-hunk">@@ -1,2 \+1,3 @@</);
});

test('renderCommitDetailsHtml: shows the short sha, with the full sha as its tooltip', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /class="sha" title="5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec">5a93a8d<\/code>/);
});

test('renderCommitDetailsHtml: heads the file section with a count and whole-commit totals', () => {
  const twoFiles: FileChange[] = [
    { path: 'a.ts', insertions: 10, deletions: 2, binary: false },
    { path: 'b.ts', insertions: 5, deletions: 8, binary: false },
  ];
  const html = renderCommitDetailsHtml({ commit, files: twoFiles, diff, now }, opts);
  assert.match(html, /class="section-title">Files changed<\/span><span class="badge">2</);
  assert.match(html, /class="totals"><span class="stat-add">\+15<\/span><span class="stat-del">&minus;10</);
});

test('renderCommitDetailsHtml: renders per-file collapsible diffs, not one whole-commit dump', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /<details class="file"/);
  // The `diff --git` / `index` / `---` / `+++` header block carries nothing the filename above
  // it doesn't already say, so it should not survive into the rendered output.
  assert.ok(!html.includes('diff --git'));
});

test('renderCommitDetailsHtml: offers a file filter box wired to the per-file sections', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /id="file-filter"/);
  assert.match(html, /aria-label="Filter changed files by path"/);
  assert.match(html, /data-filter="tracked\.txt"/);
});

test('renderCommitDetailsHtml: the copy action has a visible label, not a hidden one', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  // It reads "Copy SHA" on screen, so an aria-label would only override the visible text with a
  // second, divergent name — worse for screen-reader users, not better.
  assert.match(html, /id="copy-sha"[^>]*>(?:(?!aria-label).)*?Copy SHA<\/button>/s);
  assert.match(html, /type: 'copySha'/);
  assert.ok(!html.includes('onclick='));
});

test('renderCommitDetailsHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz 'nonce-abc123'/);
  assert.ok(!html.includes('unsafe-inline'));
});

test('renderCommitDetailsHtml: escapes HTML special characters in commit-sourced fields', () => {
  const malicious: CommitDetail = {
    ...commit,
    author: '<img src=x onerror=alert(1)>',
    message: 'fix <script>alert(1)</script> bug',
    body: 'fix <script>alert(1)</script> bug',
  };
  const html = renderCommitDetailsHtml({ commit: malicious, files: [], diff: '', now }, opts);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderCommitDetailsHtml: shows "No files changed" when the list is empty', () => {
  const html = renderCommitDetailsHtml({ commit, files: [], diff: '', now }, opts);
  assert.match(html, /No files changed\./);
});

test('renderCommitDetailsHtml: omits the extra body block when the message has no body beyond the subject', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.ok(!html.includes('class="commit-body"'));
});

test('renderCommitDetailsHtml: shows the body block when there is more than the subject', () => {
  const withBody: CommitDetail = { ...commit, body: 'add line three\n\nThis closes the loop on the fixture.' };
  const html = renderCommitDetailsHtml({ commit: withBody, files, diff, now }, opts);
  assert.match(html, /class="commit-body">This closes the loop on the fixture\.</);
});

test('renderCommitDetailsHtml: links an issue reference in the message when issueLinking is provided', () => {
  const withIssue: CommitDetail = { ...commit, message: 'fix #12 crash', body: 'fix #12 crash' };
  const html = renderCommitDetailsHtml(
    { commit: withIssue, files, diff, now },
    { ...opts, issueLinking: { pattern: '#(\\d+)', urlTemplate: 'https://github.com/o/r/issues/{issue}' } },
  );
  assert.match(html, /<h1 title="fix #12 crash">fix <a href="https:\/\/github\.com\/o\/r\/issues\/12"[^>]*>#12<\/a> crash<\/h1>/);
});

test('renderCommitDetailsHtml: without issueLinking, "#12" is left as plain escaped text, not a link', () => {
  const withIssue: CommitDetail = { ...commit, message: 'fix #12 crash', body: 'fix #12 crash' };
  const html = renderCommitDetailsHtml({ commit: withIssue, files, diff, now }, opts);
  assert.ok(!html.includes('issues/12'));
  assert.match(html, /<h1 title="fix #12 crash">fix #12 crash<\/h1>/);
});

test('renderCommitDetailsHtml: issue link href is HTML-escaped and opens in a new tab safely', () => {
  const withIssue: CommitDetail = { ...commit, message: 'fix #12', body: 'fix #12' };
  const html = renderCommitDetailsHtml(
    { commit: withIssue, files, diff, now },
    { ...opts, issueLinking: { pattern: '#(\\d+)', urlTemplate: 'https://github.com/o/r/issues/{issue}' } },
  );
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});

test('renderCommitDetailsHtml: offers copy-SHA and copy-message actions', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /id="copy-sha" type="button">.*?Copy SHA<\/button>/s);
  assert.match(html, /id="copy-message" type="button">.*?Copy message<\/button>/s);
  assert.match(html, /type: 'copyMessage'/);
});

test('renderCommitDetailsHtml: names the host in the remote action, and links the commit', () => {
  const remote = { label: 'GitHub', url: 'https://github.com/o/r/commit/5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec' };
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, { ...opts, remote });
  assert.match(html, /id="open-remote"[^>]*title="https:\/\/github\.com\/o\/r\/commit\/5a93a8d3[^"]*">.*?Open on GitHub<\/button>/s);
  assert.match(html, /type: 'openRemote'/);
});

test('renderCommitDetailsHtml: hides the remote action entirely when there is no known host', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.ok(!html.includes('id="open-remote"'));
  assert.ok(!html.includes('Open on'));
});

test('renderCommitDetailsHtml: escapes a remote label and url', () => {
  const remote = { label: '<script>alert(1)</script>', url: 'https://x/"><script>alert(2)</script>' };
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, { ...opts, remote });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<script>alert(2)</script>'));
});

test('renderCommitDetailsHtml: the wrap control is a real toggle, reporting its pressed state', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /id="wrap" type="button" aria-pressed="false"/);
  assert.match(html, /aria-label="Wrap long lines"/);
  assert.match(html, /classList\.toggle\('wrap'\)/);
});

test('renderCommitDetailsHtml: Open changes posts the file path without toggling its <details>', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /type: 'openFileDiff'/);
  // stopPropagation is what keeps the button from also collapsing the section it sits in.
  assert.match(html, /e\.stopPropagation\(\)/);
});

test('renderCommitDetailsHtml: links every stylesheet it is given, shared rules first', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  const shared = html.indexOf('shared.css');
  const own = html.indexOf('commitDetails.css');
  assert.ok(shared !== -1 && own !== -1, 'expected both stylesheets to be linked');
  assert.ok(shared < own, 'shared rules must come first so the panel can override them');
});

test('renderCommitDetailsHtml: numbers the diff gutter from the hunk header', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /<span class="dn dn-old">1<\/span><span class="dn dn-new">1<\/span><span class="dc diff-ctx"> line one</);
  assert.match(html, /<span class="dn dn-old"><\/span><span class="dn dn-new">3<\/span><span class="dc diff-add">\+line three</);
});

test('renderCommitDetailsHtml: offers a Summarize with AI button that posts explainCommit', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /id="explain-commit" type="button">.*?Summarize with AI<\/button>/s);
  assert.match(html, /type: 'explainCommit'/);
});

test('renderCommitDetailsHtml: the AI summary text and hint start hidden', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /id="ai-summary-text"[^>]*hidden/);
  assert.match(html, /id="ai-summary-hint"[^>]*hidden/);
});

test('renderCommitDetailsHtml: the aiSummaryChunk handler unhides the summary text before appending', () => {
  // Regression test: the text element starts `hidden` in the static HTML. Any code path that
  // invokes explainCommit() without going through the button's own click handler (the click
  // handler is the only thing that currently unhides it) would stream into a permanently
  // invisible element unless the chunk handler itself unhides it too.
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(
    html,
    /if \(msg\.type === 'aiSummaryChunk'\) \{\s*summaryText\.hidden = false;\s*summaryText\.textContent \+= msg\.text;/,
  );
});
