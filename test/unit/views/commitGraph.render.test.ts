import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGraphHtml } from '../../../src/views/CommitGraph/render';
import { layoutGraph } from '../../../src/core/graph/layout';
import type { BranchInfo, GraphCommit, WorkingChanges } from '../../../src/core/git/types';

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
    filesChanged: 3,
    insertions: 12,
    deletions: 4,
    ...overrides,
  };
}

const now = new Date('2024-02-04T10:00:00Z');
const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/commitGraph.css'],
};

test('renderGraphHtml: includes commit message, author, age, sha, and ref labels', () => {
  const commits = [commit('C', ['A'], { message: 'add feature', refs: [{ name: 'main', type: 'branch' }] })];
  const nodes = layoutGraph(commits);
  const html = renderGraphHtml({ nodes, now }, opts);
  assert.match(html, /add feature/);
  assert.match(html, /Raj Jadon/);
  assert.match(html, /3 days ago/);
  assert.match(html, />C<\/code>/);
  assert.match(html, /class="ref ref-branch"[^>]*>.*?main<\/span>/s);
});

test('renderGraphHtml: renders GitLens\'s seven column headers', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  for (const header of ['Branch / Tag', 'Graph', 'Commit Message', 'Author', 'Changes', 'Commit Date', 'SHA']) {
    assert.match(html, new RegExp(`role="columnheader">${header.replace(/\//g, '\\/')}<`));
  }
});

test('renderGraphHtml: the Changes column shows the changed-file count, with the line stat as its tooltip', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /class="file-count">3</);
  assert.match(html, /title="3 files, \+12 −4"/);
});

test('renderGraphHtml: a zero-file (merge) commit explains the empty stat instead of showing a bare 0', () => {
  const merge = commit('M', ['A', 'B'], { filesChanged: 0, insertions: 0, deletions: 0 });
  const html = renderGraphHtml({ nodes: layoutGraph([merge]), now }, opts);
  assert.match(html, /title="No per-file stat \(merge commit\)"/);
});

test('renderGraphHtml: gives the current branch, a local branch, a remote branch and a tag distinct styling', () => {
  // One ref per commit: the visible-label cap is 1, so stacking them on a single commit would hide
  // every type but the highest-ranked and prove nothing about the others.
  const commits = [
    commit('A', [], { refs: [{ name: 'master', type: 'branch', isHead: true }] }),
    commit('B', [], { refs: [{ name: 'feature/x', type: 'branch' }] }),
    commit('C', [], { refs: [{ name: 'origin/master', type: 'remoteBranch' }] }),
    commit('D', [], { refs: [{ name: 'v1.0.0', type: 'tag' }] }),
  ];
  const html = renderGraphHtml({ nodes: layoutGraph(commits), now }, opts);
  assert.match(html, /class="ref ref-branch ref-head" title="master \(current\)"/);
  assert.match(html, /class="ref ref-branch" title="feature\/x"/);
  assert.match(html, /class="ref ref-remoteBranch" title="origin\/master"/);
  assert.match(html, /class="ref ref-tag" title="v1\.0\.0"/);
});

test('renderGraphHtml: the checked-out branch outranks a remote ref when the label cap is hit', () => {
  // Three refs, two visible slots: the remote-tracking ref is the one that should be folded away,
  // because it only restates the local branch sitting on the same commit.
  const refs: GraphCommit['refs'] = [
    { name: 'origin/master', type: 'remoteBranch' },
    { name: 'v9', type: 'tag' },
    { name: 'master', type: 'branch', isHead: true },
  ];
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [], { refs })]), now }, opts);
  assert.match(html, /ref-head" title="master \(current\)"/);
  assert.match(html, /class="ref ref-more" title="v9, origin\/master">\+2</);
  assert.ok(!html.includes('class="ref ref-remoteBranch"'));
});

test('renderGraphHtml: caps visible ref labels, folding the rest into a "+N" label', () => {
  const refs = ['main', 'develop', 'v1.0', 'v1.1'].map((name) => ({ name, type: 'branch' as const }));
  const nodes = layoutGraph([commit('A', [], { refs })]);
  const html = renderGraphHtml({ nodes, now }, opts);
  const labelCount = (html.match(/class="ref ref-/g) ?? []).length;
  assert.equal(labelCount, 2); // 1 visible + one "+N" overflow label
  assert.match(html, /class="ref ref-more" title="develop, v1\.0, v1\.1">\+3</);
});

test('renderGraphHtml: draws an avatar node per commit, with curves for lane-changing edges', () => {
  const commits = [commit('Merge', ['A', 'B']), commit('B', []), commit('A', [])];
  const nodes = layoutGraph(commits);
  const html = renderGraphHtml({ nodes, now }, opts);
  const imageCount = (html.match(/<image /g) ?? []).length;
  const lineCount = (html.match(/<line/g) ?? []).length;
  const pathCount = (html.match(/<path d="M/g) ?? []).length;
  assert.equal(imageCount, 3); // one avatar per commit, clipped into the node circle
  assert.ok(lineCount >= 1); // the merge's same-lane outgoing edge stays a straight line
  assert.ok(pathCount >= 1); // the merge's other parent is a different lane — a curved path
});

test('renderGraphHtml: rings each avatar node in its lane color', () => {
  const nodes = layoutGraph([commit('A', [])]);
  const html = renderGraphHtml({ nodes, now }, opts);
  assert.match(html, /<circle cx="\d+" cy="\d+" r="6" fill="none" stroke="var\(--vscode-charts-blue\)"/);
});

test('renderGraphHtml: pins a Working Changes row with per-status file counts when the tree is dirty', () => {
  const workingChanges: WorkingChanges = { added: 5, modified: 11, deleted: 3, total: 19 };
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), workingChanges, now }, opts);
  assert.match(html, /class="row wip"/);
  assert.match(html, /Working Changes/);
  assert.match(html, /class="stat-add" title="5 added">\+5</);
  assert.match(html, /class="stat-mod" title="11 modified">~11</);
  assert.match(html, /class="stat-del" title="3 deleted">&minus;3</);
  // The row sits above the newest commit, exactly as GitLens orders it.
  assert.ok(html.indexOf('class="row wip"') < html.indexOf('class="row commit'));
});

test('renderGraphHtml: omits the Working Changes row on a clean tree', () => {
  const workingChanges: WorkingChanges = { added: 0, modified: 0, deleted: 0, total: 0 };
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), workingChanges, now }, opts);
  assert.ok(!html.includes('class="row wip"'));
});

test('renderGraphHtml: the ref picker lists local and remote branches, marking the current one', () => {
  const branches: BranchInfo[] = [
    { name: 'master', isRemote: false, isCurrent: true },
    { name: 'feature/x', isRemote: false, isCurrent: false },
    { name: 'origin/master', isRemote: true, isCurrent: false },
  ];
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), branches, currentRef: 'master', now }, opts);
  assert.match(html, /<option value="">All branches<\/option>/);
  assert.match(html, /<optgroup label="Local">/);
  assert.match(html, /<optgroup label="Remote">/);
  assert.match(html, /<option value="master" selected>master \(current\)<\/option>/);
});

test('renderGraphHtml: marks the given sha as the selected row and makes it the tab stop', () => {
  const commits = [commit('aaa', []), commit('bbb', [])];
  const html = renderGraphHtml({ nodes: layoutGraph(commits), selectedSha: 'bbb', now }, opts);
  assert.match(html, /class="row commit selected" role="row" tabindex="0" aria-selected="true" data-sha="bbb"/);
  assert.match(html, /class="row commit" role="row" tabindex="-1" aria-selected="false" data-sha="aaa"/);
});

test('renderGraphHtml: exactly one row is tab-reachable, so 200 commits do not become 200 tab stops', () => {
  const commits = ['a', 'b', 'c', 'd'].map((sha) => commit(sha, []));
  const html = renderGraphHtml({ nodes: layoutGraph(commits), now }, opts);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 3);
});

test('renderGraphHtml: with a dirty tree and no selection, the Working Changes row is the tab stop', () => {
  // Regression: the tab stop was computed per commit row, so a pinned working-changes row above
  // them consumed the "first row" slot without ever being made reachable — leaving the grid with
  // no tab stop at all on any dirty repo.
  const workingChanges: WorkingChanges = { added: 1, modified: 0, deleted: 0, total: 1 };
  const html = renderGraphHtml({ nodes: layoutGraph([commit('a', []), commit('b', [])]), workingChanges, now }, opts);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /class="row wip" role="row" tabindex="0"/);
});

test('renderGraphHtml: a selection takes the tab stop back from the Working Changes row', () => {
  const workingChanges: WorkingChanges = { added: 1, modified: 0, deleted: 0, total: 1 };
  const html = renderGraphHtml(
    { nodes: layoutGraph([commit('a', []), commit('b', [])]), workingChanges, selectedSha: 'b', now },
    opts,
  );
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /class="row wip" role="row" tabindex="-1"/);
  assert.match(html, /tabindex="0" aria-selected="true" data-sha="b"/);
});

test('renderGraphHtml: a selected sha filtered out of the result set does not strand the tab stop', () => {
  // Scoping the graph to another branch can drop the previously selected commit entirely.
  const html = renderGraphHtml({ nodes: layoutGraph([commit('a', [])]), selectedSha: 'gone', now }, opts);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.ok(!html.includes('aria-selected="true"'));
});

test('renderGraphHtml: rows carry a lowercased filter haystack of message, author, and sha', () => {
  const commits = [commit('DEADBEEF', [], { message: 'Fix The Thing', author: 'Amy Dev' })];
  const html = renderGraphHtml({ nodes: layoutGraph(commits), now }, opts);
  assert.match(html, /data-filter="fix the thing amy dev deadbeef"/);
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

test('renderGraphHtml: escapes a branch name injected through the ref picker', () => {
  const branches: BranchInfo[] = [{ name: '"><script>alert(1)</script>', isRemote: false, isCurrent: false }];
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), branches, now }, opts);
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('renderGraphHtml: rows post openCommit, the wip row posts openWorkingChanges, no inline handlers', () => {
  const workingChanges: WorkingChanges = { added: 1, modified: 0, deleted: 0, total: 1 };
  const html = renderGraphHtml({ nodes: layoutGraph([commit('deadbeef', [])]), workingChanges, now }, opts);
  assert.match(html, /data-sha="deadbeef"/);
  assert.match(html, /type: 'openCommit'/);
  assert.match(html, /type: 'openWorkingChanges'/);
  assert.ok(!html.includes('onclick='));
});

test('renderGraphHtml: the toolbar posts setRef and refresh', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /type: 'setRef'/);
  assert.match(html, /type: 'refresh'/);
});

test('renderGraphHtml: rows are a keyboard-navigable grid, not a stack of buttons', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /role="grid"/);
  assert.match(html, /class="row commit"[^>]*role="row"/);
  assert.match(html, /role="gridcell"/);
  assert.match(html, /'ArrowDown'/);
  assert.match(html, /'ArrowUp'/);
});

test("renderGraphHtml: sets --graph-svg-width via a nonce'd <style> block, not a CSP-blocked inline style attribute", () => {
  // Regression: an inline style="--x:...px" attribute is blocked by a style-src CSP with no
  // 'unsafe-inline'/nonce, silently dropping the custom property. That leaves grid-template-columns
  // referencing an unset var(), which falls back to `none` and collapses every row into its own
  // implicit line — invisible to string-matching tests unless you specifically check for it.
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /style-src [^;]*'nonce-abc123'/);
  assert.match(html, /<style nonce="abc123">:root \{ --graph-svg-width: \d+px; --graph-row-height: \d+px; \}<\/style>/);
  assert.ok(!html.includes('style="--graph-svg-width'));
});

test('renderGraphHtml: an empty repo says so instead of rendering a bare header', () => {
  const html = renderGraphHtml({ nodes: [], now }, opts);
  assert.match(html, /No commits yet\./);
  assert.match(html, />0 commits</);
});

test('renderGraphHtml: links every stylesheet it is given, shared rules first', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  const shared = html.indexOf('shared.css');
  const own = html.indexOf('commitGraph.css');
  assert.ok(shared !== -1 && own !== -1, 'expected both stylesheets to be linked');
  assert.ok(shared < own, 'shared rules must come first so the panel can override them');
});

test('renderGraphHtml: pluralizes the commit count', () => {
  assert.match(renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts), />1 commit</);
  assert.match(
    renderGraphHtml({ nodes: layoutGraph([commit('A', []), commit('B', [])]), now }, opts),
    />2 commits</,
  );
});
