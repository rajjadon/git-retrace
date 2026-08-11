import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { buildBranchFixtureRepo } from '../fixtures/build-fixture-repo';
import type { GitRetraceTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';


async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite('Branch comparison webview', () => {
  let api: GitRetraceTestApi;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitRetraceTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  async function openComparison(): Promise<string> {
    const fixture = buildBranchFixtureRepo();
    const doc = await vscode.workspace.openTextDocument(fixture.trackedFile);
    await vscode.window.showTextDocument(doc);

    // Passing (base, compare) explicitly skips the default-ref resolution.
    await vscode.commands.executeCommand(COMMANDS.compareBranches, fixture.baseBranch, fixture.featureBranch);
    await waitFor(() => (api.getBranchComparisonHtml() ?? '').includes('add feature line'));
    return api.getBranchComparisonHtml() ?? '';
  }

  test('shows ahead commits, files changed, and diff between two branches', async () => {
    const html = await openComparison();
    assert.match(html, /add feature line/);
    assert.match(html, /Amy Dev/);
    assert.match(html, /tracked\.txt/);
    assert.match(html, /class="dc diff-add">\+feature line</);
    assert.ok(!html.includes('unsafe-inline'));
  });

  test('renders the ref bar, the swap control, and the Ahead/Behind/All Files tabs with counts', async () => {
    const html = await openComparison();
    assert.match(html, /class="ref-pick ref-base">/);
    assert.match(html, /class="ref-pick ref-compare">/);
    assert.match(html, /id="swap"/);
    // The fixture's feature branch is one commit ahead of main and nothing behind.
    assert.match(html, /data-pane="ahead">Ahead<span class="badge badge-ahead">1<\/span>/);
    assert.match(html, /data-pane="behind">Behind<span class="badge badge-behind">0<\/span>/);
    assert.match(html, /data-pane="files">All Files<span class="badge badge-files">1<\/span>/);
    // Something is ahead, so that's the pane it opens on.
    assert.match(html, /id="tab-ahead"[^>]*aria-selected="true"/);
  });

  test('states the good outcome in the empty Behind pane rather than "no results"', async () => {
    const html = await openComparison();
    assert.match(html, /is up to date with main<\/span>/);
  });

  test('both refs appear in the pickers so the comparison can be retargeted in place', async () => {
    const html = await openComparison();
    assert.match(html, /<option value="main" selected>main<\/option>/);
    assert.match(html, /<option value="feature-x" selected>feature-x<\/option>/);
  });

  test('shows an info message instead of a broken flow with no active editor context', async () => {
    // Falls back to the workspace folder, which is the single-branch fixture repo — there is
    // nothing to compare it against, so the command reports that and stops.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand(COMMANDS.compareBranches);
  });
});
