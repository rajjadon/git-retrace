import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLaunchpadHtml } from '../../../src/views/Launchpad/render';
import type { CategorizedPullRequest, PullRequestSummary } from '../../../src/core/forge/types';

process.env.TZ = 'UTC';

const now = new Date('2024-02-04T10:00:00Z');
const opts = { nonce: 'abc123', cspSource: 'vscode-webview://xyz', styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/launchpad.css'] };

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

test('renderLaunchpadHtml: renders all six columns in the roadmap-specified order, with counts', () => {
  // At least one PR, so the board actually renders instead of the "nothing to show" empty state.
  const categorized: CategorizedPullRequest[] = [{ pr: pr(), bucket: 'waiting' }];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  const titles = [...html.matchAll(/class="column-title">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(titles, ['Needs Review', 'Ready to Merge', 'Waiting', 'Blocked', 'Drafts', 'Snoozed']);
});

test('renderLaunchpadHtml: places a PR card in its bucket\'s column with a count badge', () => {
  const categorized: CategorizedPullRequest[] = [{ pr: pr(), bucket: 'needsReview' }];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  assert.match(html, /data-bucket="needsReview"[\s\S]*?Add feature[\s\S]*?<\/div>\s*<\/div>/);
  assert.match(html, /data-bucket="needsReview">[\s\S]*?class="badge">1</);
});

test('renderLaunchpadHtml: an empty column says "Nothing here", not a blank space', () => {
  // Something in "waiting" so the board renders at all; "drafts" stays genuinely empty.
  const categorized: CategorizedPullRequest[] = [{ pr: pr(), bucket: 'waiting' }];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  assert.match(html, /data-bucket="drafts">[\s\S]*?Nothing here\./);
});

test('renderLaunchpadHtml: a card shows repo label, author, and age', () => {
  const categorized: CategorizedPullRequest[] = [{ pr: pr({ repo: { host: 'gitlab', identity: 'acme/platform', label: 'acme/platform' } }), bucket: 'waiting' }];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  assert.match(html, /class="pr-card-repo">acme\/platform</);
  assert.match(html, /raj/);
  assert.match(html, /3 days ago/);
});

test('renderLaunchpadHtml: a card posts openPr with its URL when clicked', () => {
  const categorized: CategorizedPullRequest[] = [{ pr: pr({ url: 'https://github.com/acme/widgets/pull/42' }), bucket: 'waiting' }];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  assert.match(html, /data-url="https:\/\/github\.com\/acme\/widgets\/pull\/42"/);
  assert.match(html, /type: 'openPr', url: card\.dataset\.url/);
});

test('renderLaunchpadHtml: the snooze button posts toggleSnooze with the PR\'s stable key', () => {
  const categorized: CategorizedPullRequest[] = [{ pr: pr(), bucket: 'waiting' }];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  assert.match(html, /class="pr-card-snooze[^"]*" type="button" data-key="github:acme\/widgets#1"/);
  assert.match(html, /type: 'toggleSnooze', key: btn\.dataset\.key/);
});

test('renderLaunchpadHtml: a snoozed-column card is labeled "Unsnooze" instead of "Snooze"', () => {
  const categorized: CategorizedPullRequest[] = [{ pr: pr(), bucket: 'snoozed' }];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  assert.match(html, /title="Unsnooze"/);
  assert.ok(!html.includes('title="Snooze"'));
});

test('renderLaunchpadHtml: shows a per-repo error banner without failing the whole board', () => {
  const html = renderLaunchpadHtml(
    { categorized: [], errors: [{ repo: { host: 'gitlab', identity: 'acme/x', label: 'acme/x' }, message: 'Not signed in.' }], now },
    opts,
  );
  assert.match(html, /class="error-row">acme\/x: Not signed in\.</);
});

test('renderLaunchpadHtml: nothing to show and no errors states the good outcome, not an empty board', () => {
  const html = renderLaunchpadHtml({ categorized: [], errors: [], now }, opts);
  assert.match(html, /No pull requests need your attention right now\./);
  assert.ok(!html.includes('class="board"'));
});

test('renderLaunchpadHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const html = renderLaunchpadHtml({ categorized: [], errors: [], now }, opts);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz/);
  assert.ok(!html.includes('unsafe-inline'));
});

test('renderLaunchpadHtml: escapes HTML special characters in PR-sourced fields', () => {
  const categorized: CategorizedPullRequest[] = [
    {
      pr: pr({ title: '<script>alert(1)</script>', authorLogin: '<img src=x onerror=alert(1)>' }),
      bucket: 'waiting',
    },
  ];
  const html = renderLaunchpadHtml({ categorized, errors: [], now }, opts);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderLaunchpadHtml: refresh button posts a refresh message', () => {
  const html = renderLaunchpadHtml({ categorized: [], errors: [], now }, opts);
  assert.match(html, /id="refresh"/);
  assert.match(html, /getElementById\('refresh'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'refresh' \}\);/);
});
