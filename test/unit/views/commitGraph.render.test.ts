import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGraphHtml } from '../../../src/views/CommitGraph/render';
import { layoutGraph } from '../../../src/core/graph/layout';
import type { GraphCommit } from '../../../src/core/git/types';

process.env.TZ = 'UTC';

function commit(sha: string, parents: string[], overrides: Partial<GraphCommit> = {}): GraphCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author: 'Raj Jadon',
    authorEmail: 'raj@example.com',
    date: '2024-02-01T10:00:00Z',
    message: `commit ${sha}`,
    parents,
    refs: [],
    ...overrides,
  };
}

const now = new Date('2024-02-04T10:00:00Z');
const opts = { nonce: 'abc123', cspSource: 'vscode-webview://xyz', styleUri: 'vscode-webview://xyz/style.css' };

test('renderGraphHtml: includes commit message, author, age, sha, and ref badges', () => {
  const commits = [commit('C', ['A'], { message: 'add feature', refs: [{ name: 'main', type: 'branch' }] })];
  const nodes = layoutGraph(commits);
  const html = renderGraphHtml({ nodes, now }, opts);
  assert.match(html, /add feature/);
  assert.match(html, /Raj Jadon/);
  assert.match(html, /3 days ago/);
  assert.match(html, />C<\/code>/);
  assert.match(html, /class="ref-badge ref-branch">main</);
});

test('renderGraphHtml: draws a dot per commit and lines for parent/merge edges', () => {
  const commits = [commit('Merge', ['A', 'B']), commit('B', []), commit('A', [])];
  const nodes = layoutGraph(commits);
  const html = renderGraphHtml({ nodes, now }, opts);
  const circleCount = (html.match(/<circle/g) ?? []).length;
  const lineCount = (html.match(/<line/g) ?? []).length;
  assert.equal(circleCount, 3); // one dot per commit
  assert.ok(lineCount >= 2); // at least the merge's two outgoing edges
});

test('renderGraphHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const nodes = layoutGraph([commit('A', [])]);
  const html = renderGraphHtml({ nodes, now }, opts);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz/);
  assert.ok(!html.includes('unsafe-inline'));
});

test('renderGraphHtml: escapes HTML special characters in commit-sourced fields', () => {
  const commits = [
    commit('A', [], {
      message: 'fix <script>alert(1)</script> bug',
      author: '<img src=x onerror=alert(1)>',
      refs: [{ name: '<b>evil</b>', type: 'branch' }],
    }),
  ];
  const nodes = layoutGraph(commits);
  const html = renderGraphHtml({ nodes, now }, opts);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('<b>evil</b>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderGraphHtml: each row posts an openCommit message with its sha, no inline handlers', () => {
  const nodes = layoutGraph([commit('deadbeef', [])]);
  const html = renderGraphHtml({ nodes, now }, opts);
  assert.match(html, /data-sha="deadbeef"/);
  assert.match(html, /type: 'openCommit'/);
  assert.ok(!html.includes('onclick='));
});

test('renderGraphHtml: rows are keyboard-navigable (tabindex + role=button)', () => {
  const nodes = layoutGraph([commit('A', [])]);
  const html = renderGraphHtml({ nodes, now }, opts);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /role="button"/);
});

test('renderGraphHtml: caps visible ref badges, folding the rest into a "+N" badge', () => {
  const refs = ['main', 'develop', 'v1.0', 'v1.1'].map((name) => ({ name, type: 'branch' as const }));
  const nodes = layoutGraph([commit('A', [], { refs })]);
  const html = renderGraphHtml({ nodes, now }, opts);
  const badgeCount = (html.match(/class="ref-badge/g) ?? []).length;
  assert.equal(badgeCount, 3); // 2 visible + one "+N" overflow badge
  assert.match(html, /class="ref-badge ref-more" title="v1\.0, v1\.1">\+2</);
});
