import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPullRequestDetailsHtml } from '../../../src/views/PullRequestDetails/render';
import type { ConversationThread, PullRequestSummary } from '../../../src/core/forge/types';
import type { FileChange } from '../../../src/core/git/types';

process.env.TZ = 'UTC';

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
    reviewedByMe: false,
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

test('renderPullRequestDetailsHtml: posting a comment shows a shimmering skeleton, carrying the message as an aria-label instead of visible "Posting…" text', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /class="skeleton" id="comment-status-skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="Posting…" hidden/);
  assert.match(html, /class="skeleton-row"/);
  assert.match(
    html,
    /postCommentBtn\.disabled = true;\s*commentStatus\.hidden = true;\s*commentStatusSkeleton\.hidden = false;/,
  );
  assert.ok(!html.includes('>Posting…<'));
});

test('renderPullRequestDetailsHtml: a posted or failed comment hides the skeleton', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [] }, opts);
  assert.match(html, /msg\.type === 'commentPosted'\) \{[^}]*commentStatusSkeleton\.hidden = true;/s);
  assert.match(html, /msg\.type === 'commentFailed'\) \{[^}]*commentStatusSkeleton\.hidden = true;/s);
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

const now = new Date('2024-02-10T10:00:00Z');

test('renderPullRequestDetailsHtml: the author line carries the author icon, matching Launchpad\'s own card convention', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.match(html, /class="head-author">.*svg.*raj/s);
});

test('renderPullRequestDetailsHtml: a draft PR shows a Draft badge', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr({ isDraft: true }), files, diff, threads: [], now }, opts);
  assert.match(html, /class="badge[^"]*">Draft</);
});

test('renderPullRequestDetailsHtml: a merged PR shows a Merged badge instead of ever looking like an untouched open PR', () => {
  const html = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: true }), files, diff, threads: [], now },
    opts,
  );
  assert.match(html, /class="badge[^"]*">Merged</);
});

test('renderPullRequestDetailsHtml: a closed-without-merging PR shows a Closed badge, not Merged', () => {
  const html = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: false }), files, diff, threads: [], now },
    opts,
  );
  assert.match(html, /class="badge[^"]*">Closed</);
  assert.ok(!html.includes('>Merged<'));
});

test('renderPullRequestDetailsHtml: an open PR (no closedAt) shows neither Merged nor Closed', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.ok(!html.includes('>Merged<'));
  assert.ok(!html.includes('>Closed<'));
});

test('renderPullRequestDetailsHtml: checkStatus "failing" shows a Checks failing badge', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr({ checkStatus: 'failing' }), files, diff, threads: [], now }, opts);
  assert.match(html, /class="badge[^"]*">Checks failing</);
});

test('renderPullRequestDetailsHtml: checkStatus "pending" shows a Checks running badge', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr({ checkStatus: 'pending' }), files, diff, threads: [], now }, opts);
  assert.match(html, /class="badge[^"]*">Checks running</);
});

test('renderPullRequestDetailsHtml: checkStatus "none" shows no checks badge at all — nothing to report', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr({ checkStatus: 'none' }), files, diff, threads: [], now }, opts);
  assert.ok(!html.includes('Checks'));
});

test('renderPullRequestDetailsHtml: reviewDecision "changesRequested" shows a Changes requested badge', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr({ reviewDecision: 'changesRequested' }), files, diff, threads: [], now }, opts);
  assert.match(html, /class="badge[^"]*">Changes requested</);
});

test('renderPullRequestDetailsHtml: reviewDecision "reviewRequired" shows how many reviewers are still owed one', () => {
  const html = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'reviewRequired', requestedReviewers: ['amy', 'sam'] }), files, diff, threads: [], now },
    opts,
  );
  assert.match(html, /class="badge[^"]*">2 reviews requested</);
});

test('renderPullRequestDetailsHtml: reviewDecision "none" shows no review badge at all', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr({ reviewDecision: 'none' }), files, diff, threads: [], now }, opts);
  assert.ok(!html.includes('review requested') && !html.includes('reviews requested') && !html.includes('>Approved<') && !html.includes('Changes requested'));
});

test('renderPullRequestDetailsHtml: hasConflicts shows a Has conflicts badge; a clean PR shows none', () => {
  const withConflicts = renderPullRequestDetailsHtml({ pr: pr({ hasConflicts: true }), files, diff, threads: [], now }, opts);
  assert.match(withConflicts, /class="badge[^"]*">Has conflicts</);
  const clean = renderPullRequestDetailsHtml({ pr: pr({ hasConflicts: false }), files, diff, threads: [], now }, opts);
  assert.ok(!clean.includes('Has conflicts'));
});

test('renderPullRequestDetailsHtml: always shows the PR\'s age, using closedAt when terminal and createdAt otherwise', () => {
  const open = renderPullRequestDetailsHtml({ pr: pr({ createdAt: '2024-02-08T10:00:00Z' }), files, diff, threads: [], now }, opts);
  assert.match(open, /class="head-age"[^>]*title="2024-02-08 10:00"/);
  const merged = renderPullRequestDetailsHtml(
    { pr: pr({ createdAt: '2024-01-01T00:00:00Z', closedAt: '2024-02-09T10:00:00Z', merged: true }), files, diff, threads: [], now },
    opts,
  );
  assert.match(merged, /class="head-age"[^>]*title="2024-02-09 10:00"/);
});

test('renderPullRequestDetailsHtml: an open PR shows Approve, Request Changes, and Close buttons', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.match(html, /id="approve-pr"/);
  assert.match(html, /id="request-changes-pr"/);
  assert.match(html, /id="close-pr"/);
});

test('renderPullRequestDetailsHtml: a merged or closed PR shows none of Approve/Request Changes/Close', () => {
  const html = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: true }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!html.includes('id="approve-pr"'));
  assert.ok(!html.includes('id="request-changes-pr"'));
  assert.ok(!html.includes('id="close-pr"'));
});

test('renderPullRequestDetailsHtml: a closed-without-merging PR shows a Reopen button; a merged one does not', () => {
  const closed = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: false }), files, diff, threads: [], now },
    opts,
  );
  assert.match(closed, /id="reopen-pr"/);
  const merged = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: true }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!merged.includes('id="reopen-pr"'));
});

test('renderPullRequestDetailsHtml: an open PR shows no Reopen button', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.ok(!html.includes('id="reopen-pr"'));
});

test('renderPullRequestDetailsHtml: shows Merge only when approved, checks aren\'t pending, and there are no conflicts — matching Launchpad\'s own "ready to merge" rule', () => {
  const ready = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'approved', checkStatus: 'passing', hasConflicts: false }), files, diff, threads: [], now },
    opts,
  );
  assert.match(ready, /id="merge-pr"/);

  const notApproved = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'reviewRequired', checkStatus: 'passing', hasConflicts: false }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!notApproved.includes('id="merge-pr"'));

  const pendingChecks = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'approved', checkStatus: 'pending', hasConflicts: false }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!pendingChecks.includes('id="merge-pr"'));

  const conflicted = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'approved', checkStatus: 'passing', hasConflicts: true }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!conflicted.includes('id="merge-pr"'));
});

test('renderPullRequestDetailsHtml: Approve posts submitReview with decision "approve"; Request Changes posts "requestChanges"', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.match(html, /getElementById\('approve-pr'\)\?\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'submitReview', decision: 'approve' \}\);/);
  assert.match(html, /getElementById\('request-changes-pr'\)\?\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'submitReview', decision: 'requestChanges' \}\);/);
});

test('renderPullRequestDetailsHtml: Close/Reopen/Merge buttons post closePr/reopenPr/mergePr', () => {
  const open = renderPullRequestDetailsHtml({ pr: pr({ reviewDecision: 'approved', checkStatus: 'passing' }), files, diff, threads: [], now }, opts);
  assert.match(open, /getElementById\('close-pr'\)\?\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'closePr' \}\);/);
  assert.match(open, /getElementById\('merge-pr'\)\?\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'mergePr' \}\);/);

  const closed = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: false }), files, diff, threads: [], now },
    opts,
  );
  assert.match(closed, /getElementById\('reopen-pr'\)\?\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'reopenPr' \}\);/);
});
