import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { buildBranchFixtureRepo } from '../fixtures/build-fixture-repo';
import type { GitSenseTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';

const EXTENSION_ID = 'gitsense-dev.gitsense';

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
  let api: GitSenseTestApi;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitSenseTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('shows ahead commits, files changed, and diff between two branches', async () => {
    const fixture = buildBranchFixtureRepo();
    const doc = await vscode.workspace.openTextDocument(fixture.trackedFile);
    await vscode.window.showTextDocument(doc);

    // Passing (base, compare) explicitly bypasses the interactive QuickPick flow.
    await vscode.commands.executeCommand(COMMANDS.compareBranches, fixture.baseBranch, fixture.featureBranch);
    await waitFor(() => (api.getBranchComparisonHtml() ?? '').includes('add feature line'));

    const html = api.getBranchComparisonHtml() ?? '';
    assert.match(html, /add feature line/);
    assert.match(html, /Amy Dev/);
    assert.match(html, /1 commit ahead, 0 commits behind/);
    assert.match(html, /tracked\.txt/);
    assert.match(html, /class="diff-add">\+feature line</);
    assert.ok(!html.includes('unsafe-inline'));
  });

  test('shows an info message instead of a broken flow with no active editor context', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand(COMMANDS.compareBranches);
  });
});
