import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitRetraceTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';
import { resolveRepoContextPath } from '../../src/views/CommitGraph/CommitGraphViewProvider';

const EXTENSION_ID = 'rajjadon.git-retrace';

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite('Commit graph webview', () => {
  let manifest: FixtureManifest;
  let api: GitRetraceTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitRetraceTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  async function openGraph(): Promise<string> {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(COMMANDS.openGraph);
    await waitFor(() => (api.getCommitGraphHtml() ?? '').includes('add line three'));
    return api.getCommitGraphHtml() ?? '';
  }

  test('shows every commit newest-first with an avatar node per commit', async () => {
    const html = await openGraph();
    assert.match(html, /add line three/);
    assert.match(html, /Amy Dev/);
    assert.match(html, /first commit/);
    assert.match(html, /Raj Jadon/);
    // Both fixture commits are on one linear branch — exactly two avatar nodes, no merges.
    const imageCount = (html.match(/<image /g) ?? []).length;
    assert.equal(imageCount, 2);
    assert.ok(!html.includes('unsafe-inline'));
  });

  test('renders the toolbar, the seven columns, and a scrollable grid', async () => {
    const html = await openGraph();
    assert.match(html, /id="ref-filter"/);
    assert.match(html, /id="search"/);
    assert.match(html, /id="refresh"/);
    assert.match(html, /role="grid"/);
    for (const header of ['Branch / Tag', 'Commit Message', 'Author', 'Changes', 'Commit Date', 'SHA']) {
      assert.ok(html.includes(`role="columnheader">${header}<`), `missing column header: ${header}`);
    }
    // A page heading inside a 250px-tall panel is pure overhead — the toolbar replaced it.
    assert.ok(!html.includes('<h1>Commit Graph</h1>'));
  });

  test('labels the checked-out branch from --decorate=full, not as an ambiguous ref', async () => {
    const html = await openGraph();
    assert.match(html, /class="ref ref-branch ref-head" title="main \(current\)"/);
  });

  test('shows the per-commit changed-file count from the same log call', async () => {
    const html = await openGraph();
    // Each fixture commit touches exactly tracked.txt.
    assert.match(html, /class="file-count">1</);
  });

  test('pins a Working Changes row for the fixture\'s untracked file', async () => {
    const html = await openGraph();
    assert.match(html, /class="row wip"/);
    assert.match(html, /Working Changes/);
    // untracked.txt is the repo's only uncommitted change, and untracked counts as added.
    assert.match(html, /class="stat-add" title="1 added">\+1</);
  });

  test('lists the repo\'s branches in the ref picker', async () => {
    const html = await openGraph();
    assert.match(html, /<option value="">All branches<\/option>/);
    assert.match(html, /<option value="main">main \(current\)<\/option>/);
  });

  test('falls back to the workspace folder when no editor is open, instead of refusing to open', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.equal(vscode.window.activeTextEditor, undefined);

    const contextPath = resolveRepoContextPath();
    assert.ok(contextPath, 'expected a repo context path from the workspace folder');
    assert.ok(await api.git.getRepoRoot(contextPath), 'workspace-folder fallback did not resolve to a git repo');

    // And the command itself stays quiet rather than throwing.
    await vscode.commands.executeCommand(COMMANDS.openGraph);
  });
});
