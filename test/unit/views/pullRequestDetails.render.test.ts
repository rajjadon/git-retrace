import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPullRequestDetailsHtml } from '../../../src/views/PullRequestDetails/render';
import type { ConversationThread, PullRequestSummary } from '../../../src/core/forge/types';
import type { FileChange } from '../../../src/core/git/types';

function pr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    repo: { host: 'github', identity: 'acme/widgets', label: 'acme/widgets' },
    number: 1,
    title: 'Add feature',
    url: 'https://github.com/acme/widgets/pull/1',
    authorLogin: 'raj',
    isDraft: false,
    createdAt: '2024-02-01T10:00:00Z',
    updatedAt: '2024-02-01T10:00:00Z',
    requestedReviewers: [],
    checkStatus: 'passing',
    reviewDecision: 'approved',
    hasConflicts: false,
    ...overrides,
  };
}

const files: FileChange[] = [{ path: 'src/a.ts', insertions: 3, deletions: 1, binary: false }];
const diff = 'diff --git a/src/a.ts b/src/a.ts\n@@ -1,2 +1,3 @@\n line one\n+line two\n';

const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/pullRequestDetails.css'],
};

test('renderPullRequestDetailsHtml: includes PR metadata, files, and diff', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /<h1 title="Add feature">Add feature<\/h1>/);
  assert.match(html, /raj/);
  assert.match(html, /acme\/widgets/);
  assert.match(html, /src\/a\.ts/);
  assert.match(html, /class="dc diff-add">\+line two</);
});

test('renderPullRequestDetailsHtml: heads the file section with a count and whole-PR totals', () => {
  const twoFiles: FileChange[] = [
    { path: 'a.ts', insertions: 10, deletions: 2, binary: false },
    { path: 'b.ts', insertions: 5, deletions: 8, binary: false },
  ];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files: twoFiles, diff: '', threads: [] }, opts);
  assert.match(html, /class="badge">2</);
  assert.match(html, /class="stat-add">\+15</);
  assert.match(html, /class="stat-del">&minus;10</);
});

test('renderPullRequestDetailsHtml: no fabricated stats for a host with no diff text (Azure DevOps gap) — shows 0/0, not a guess', () => {
  const noStatFiles: FileChange[] = [{ path: 'src/a.ts', insertions: 0, deletions: 0, binary: false }];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files: noStatFiles, diff: '', threads: [] }, opts);
  assert.match(html, /No textual diff for this file\./);
  assert.match(html, /class="stat-add">\+0</);
});

test('renderPullRequestDetailsHtml: "Open on <host>" button posts openRemote', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /id="open-remote"/);
  assert.match(html, /getElementById\('open-remote'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'openRemote' \}\);/);
});

test('renderPullRequestDetailsHtml: the comment button posts addComment with the textarea\'s value', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /id="comment-body"/);
  assert.match(html, /id="post-comment"/);
  assert.match(html, /vscode\.postMessage\(\{ type: 'addComment', body \}\);/);
});

test('renderPullRequestDetailsHtml: escapes HTML special characters in PR-sourced fields', () => {
  const html = renderPullRequestDetailsHtml(
    { pr: pr({ title: '<script>alert(1)</script>', authorLogin: '<img src=x onerror=alert(1)>' }), files, diff, threads: [] },
    opts,
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderPullRequestDetailsHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz/);
  assert.ok(!html.includes('unsafe-inline'));
});

test('renderPullRequestDetailsHtml: shows a "No review conversations" message when there are none', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /No review conversations on this pull request\./);
});

test('renderPullRequestDetailsHtml: an unresolved thread gets a Resolve button; a resolved one doesn\'t', () => {
  const threads: ConversationThread[] = [
    { id: 't1', body: 'Fix this', authorLogin: 'amy', resolved: false },
    { id: 't2', body: 'Already fine', authorLogin: 'raj', resolved: true },
  ];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads }, opts);
  assert.match(html, /class="thread gitlore-enter" data-thread-id="t1">[\s\S]*?class="thread-resolve[^"]*" type="button" data-thread-id="t1"/);
  assert.ok(!/class="thread gitlore-enter thread-resolved" data-thread-id="t2">[\s\S]*?class="thread-resolve/.test(html));
  assert.match(html, /class="thread gitlore-enter thread-resolved" data-thread-id="t2"/);
});

test('renderPullRequestDetailsHtml: the Resolve button posts resolveThread with the thread\'s id', () => {
  const threads: ConversationThread[] = [{ id: 't1', body: 'Fix this', authorLogin: 'amy', resolved: false }];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads }, opts);
  assert.match(html, /vscode\.postMessage\(\{ type: 'resolveThread', threadId: btn\.dataset\.threadId \}\);/);
});

test('renderPullRequestDetailsHtml: escapes HTML special characters in thread fields', () => {
  const threads: ConversationThread[] = [
    { id: 't1', body: '<script>alert(1)</script>', authorLogin: '<img src=x onerror=alert(1)>', resolved: false },
  ];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads }, opts);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});

test('renderPullRequestDetailsHtml: a thread anchored to a diff line shows its file and line', () => {
  const threads: ConversationThread[] = [{ id: 't1', body: 'Fix this', authorLogin: 'amy', resolved: false, file: 'src/a.ts', line: 42 }];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads }, opts);
  assert.match(html, /class="thread-location">src\/a\.ts:42</);
});

test('renderPullRequestDetailsHtml: Azure DevOps\' leading-slash file paths are shown without it', () => {
  const threads: ConversationThread[] = [{ id: 't1', body: 'Fix this', authorLogin: 'amy', resolved: false, file: '/src/a.ts', line: 3 }];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads }, opts);
  assert.match(html, /class="thread-location">src\/a\.ts:3</);
});

test('renderPullRequestDetailsHtml: a general PR-level comment (not attached to any line) shows no location', () => {
  const threads: ConversationThread[] = [{ id: 't1', body: 'Looks good overall', authorLogin: 'amy', resolved: false }];
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads }, opts);
  assert.ok(!html.includes('thread-location'));
});

test('renderPullRequestDetailsHtml: a Refresh button posts refresh', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /id="refresh-pr"/);
  assert.match(html, /getElementById\('refresh-pr'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'refresh' \}\);/);
});
