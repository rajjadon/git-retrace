import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBranchComparisonHtml } from '../../../src/views/BranchComparison/render';
import type { BranchInfo, Commit, FileChange } from '../../../src/core/git/types';

process.env.TZ = 'UTC';

const now = new Date('2024-02-04T10:00:00Z');

function commit(sha: string, message: string, overrides: Partial<Commit> = {}): Commit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author: 'Amy Dev',
    authorEmail: 'amy@example.com',
    date: '2024-02-01T10:00:00Z',
    message,
    ...overrides,
  };
}

const branches: BranchInfo[] = [
  { name: 'main', isRemote: false, isCurrent: true },
  { name: 'feature-x', isRemote: false, isCurrent: false },
  { name: 'origin/main', isRemote: true, isCurrent: false },
];

const files: FileChange[] = [{ path: 'src/a.ts', insertions: 12, deletions: 3, binary: false }];
const diff = 'diff --git a/src/a.ts b/src/a.ts\n@@ -1,2 +1,3 @@\n keep\n+added\n';

const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/branchComparison.css'],
  editorFontFamily: 'Menlo',
};

const base = { base: 'main', compare: 'feature-x', branches, files, diff, now };
const ahead = [commit('aaaaaaa1', 'add feature line')];
const behind = [commit('bbbbbbb2', 'hotfix on main')];

function render(overrides: Partial<Parameters<typeof renderBranchComparisonHtml>[0]> = {}): string {
  return renderBranchComparisonHtml(
    { ...base, aheadCommits: ahead, behindCommits: behind, ...overrides },
    opts,
  );
}

test('renderBranchComparisonHtml: renders both ref pickers with the current refs selected', () => {
  const html = render();
  assert.match(html, /class="ref-pick ref-base">.*?<select id="base"/s);
  assert.match(html, /class="ref-pick ref-compare">.*?<select id="compare"/s);
  assert.match(html, /<option value="main" selected>main<\/option>/);
  assert.match(html, /<option value="feature-x" selected>feature-x<\/option>/);
  assert.match(html, /<optgroup label="Local">/);
  assert.match(html, /<optgroup label="Remote">/);
});

test('renderBranchComparisonHtml: labels each picker by the role it plays in the diff', () => {
  const html = render();
  assert.match(html, /aria-label="Base ref — the side changes are measured from"/);
  assert.match(html, /aria-label="Compare ref — the side changes are measured to"/);
});

test('renderBranchComparisonHtml: keeps a selected ref that is not in the branch list', () => {
  // Comparing against a tag or a raw SHA must not vanish from the picker when the other side changes.
  const html = render({ base: 'v1.0.0' });
  assert.match(html, /<option value="v1\.0\.0" selected>v1\.0\.0<\/option>/);
});

test('renderBranchComparisonHtml: the swap button posts the two refs in reverse', () => {
  const html = render();
  assert.match(html, /id="swap"/);
  assert.match(
    html,
    /getElementById\('swap'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'setRefs', base: document\.getElementById\('compare'\)\.value, compare: document\.getElementById\('base'\)\.value \}\);/,
  );
});

test('renderBranchComparisonHtml: the tab strip carries a count badge per view', () => {
  const html = render();
  assert.match(html, /data-pane="ahead">Ahead<span class="badge badge-ahead">1<\/span>/);
  assert.match(html, /data-pane="behind">Behind<span class="badge badge-behind">1<\/span>/);
  assert.match(html, /data-pane="files">All Files<span class="badge badge-files">1<\/span>/);
});

test('renderBranchComparisonHtml: opens on Ahead when the compare ref has commits of its own', () => {
  const html = render();
  assert.match(html, /id="tab-ahead"[^>]*aria-selected="true"/);
  assert.match(html, /id="pane-ahead" role="tabpanel" aria-labelledby="tab-ahead">/);
  assert.match(html, /id="pane-behind"[^>]*hidden>/);
});

test('renderBranchComparisonHtml: falls through to Behind when nothing is ahead', () => {
  const html = render({ aheadCommits: [] });
  assert.match(html, /id="tab-behind"[^>]*aria-selected="true"/);
  assert.match(html, /id="pane-ahead"[^>]*hidden>/);
});

test('renderBranchComparisonHtml: falls through to All Files when the branches are level', () => {
  const html = render({ aheadCommits: [], behindCommits: [] });
  assert.match(html, /id="tab-files"[^>]*aria-selected="true"/);
  assert.match(html, /id="pane-files" role="tabpanel" aria-labelledby="tab-files">/);
});

test('renderBranchComparisonHtml: empty panes state what is true, not "no results"', () => {
  const html = render({ aheadCommits: [], behindCommits: [] });
  assert.match(html, /class="empty-state">.*?feature-x adds nothing over main<\/span>/s);
  assert.match(html, /class="empty-state">.*?feature-x is up to date with main<\/span>/s);
});

test('renderBranchComparisonHtml: comparing a ref against itself asks for a second ref', () => {
  const html = render({ base: 'main', compare: 'main', files: [], diff: '' });
  assert.match(html, /Pick two different refs to compare\./);
  // No point offering a filter box over an empty list.
  assert.ok(!html.includes('id="file-filter"'));
});

test('renderBranchComparisonHtml: lists commits with author, age and short sha', () => {
  const html = render();
  assert.match(html, /class="commit-message" title="add feature line">add feature line</);
  assert.match(html, /class="commit-author">Amy Dev</);
  assert.match(html, /class="commit-age" title="2024-02-01 10:00">3 days ago</);
  assert.match(html, /class="commit-sha">aaaaaaa</);
});

test('renderBranchComparisonHtml: commit rows post openCommit and are keyboard-reachable', () => {
  const html = render();
  assert.match(html, /class="commit-row" role="row" tabindex="0" data-sha="aaaaaaa1"/);
  assert.match(html, /type: 'openCommit'/);
  assert.ok(!html.includes('onclick='));
});

test('renderBranchComparisonHtml: the files pane reuses the shared per-file sections and totals', () => {
  const html = render();
  assert.match(html, /<details class="file"/);
  assert.match(html, /class="stat-add">\+12<\/span><span class="stat-del">&minus;3</);
  assert.match(html, /class="dc diff-add">\+added</);
  assert.match(html, /id="file-filter"/);
  assert.match(html, /id="wrap" type="button" aria-pressed="false"/);
});

test('renderBranchComparisonHtml: role="tablist" comes with the arrow-key navigation it promises', () => {
  const html = render();
  assert.match(html, /role="tablist"/);
  assert.match(html, /'ArrowRight'/);
  assert.match(html, /'ArrowLeft'/);
});

test('renderBranchComparisonHtml: exactly one tab is a tab stop', () => {
  const html = render();
  assert.equal((html.match(/class="tab active"[^>]*tabindex="0"/g) ?? []).length, 1);
  assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 2);
});

test('renderBranchComparisonHtml: links every stylesheet it is given, shared rules first', () => {
  const html = render();
  const shared = html.indexOf('shared.css');
  const own = html.indexOf('branchComparison.css');
  assert.ok(shared !== -1 && own !== -1);
  assert.ok(shared < own);
});

test('renderBranchComparisonHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const html = render();
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz 'nonce-abc123'/);
  assert.ok(!html.includes('unsafe-inline'));
});

test('renderBranchComparisonHtml: no Create PR button when there is no createPr target', () => {
  const html = render();
  assert.ok(!html.includes('id="create-pr"'));
});

test('renderBranchComparisonHtml: renders a Create PR button when a createPr target is given', () => {
  const html = renderBranchComparisonHtml(
    { ...base, aheadCommits: ahead, behindCommits: behind },
    { ...opts, createPr: { label: 'GitHub' } },
  );
  assert.match(html, /id="create-pr"/);
  assert.match(html, /Create a PR on GitHub/);
  assert.match(html, /getElementById\('create-pr'\)/);
  assert.match(html, /type: 'createPr'/);
});

test('renderBranchComparisonHtml: the Open all changes button posts openAllChanges when there are files', () => {
  const html = render();
  assert.match(html, /id="open-all"/);
  assert.match(html, /type: 'openAllChanges'/);
});

test('renderBranchComparisonHtml: no Open all changes button when there are no files to open', () => {
  const html = render({ base: 'main', compare: 'main', files: [], diff: '' });
  assert.ok(!html.includes('id="open-all"'));
});

test('renderBranchComparisonHtml: escapes ref names, commit messages and authors', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderBranchComparisonHtml(
    {
      base: evil,
      compare: 'main',
      branches: [{ name: evil, isRemote: false, isCurrent: false }],
      aheadCommits: [commit('c1', evil, { author: '<img src=x onerror=alert(1)>' })],
      behindCommits: [],
      files: [],
      diff: '',
      now,
    },
    opts,
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
