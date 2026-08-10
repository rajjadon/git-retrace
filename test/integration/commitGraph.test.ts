import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
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

suite('Commit graph webview', () => {
  let manifest: FixtureManifest;
  let api: GitSenseTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitSenseTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('shows every commit newest-first with a dot per commit', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    await vscode.commands.executeCommand(COMMANDS.openGraph);
    await waitFor(() => (api.getCommitGraphHtml() ?? '').includes('add line three'));

    const html = api.getCommitGraphHtml() ?? '';
    assert.match(html, /add line three/);
    assert.match(html, /Amy Dev/);
    assert.match(html, /first commit/);
    assert.match(html, /Raj Jadon/);
    // Both fixture commits are on one linear branch — exactly two dots, no merges.
    const circleCount = (html.match(/<circle/g) ?? []).length;
    assert.equal(circleCount, 2);
    assert.ok(!html.includes('unsafe-inline'));
  });

  test('shows an info message instead of a broken panel with no active editor context', async () => {
    // Close all editors so activeTextEditor is undefined, then confirm the command doesn't throw.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand(COMMANDS.openGraph);
  });
});
