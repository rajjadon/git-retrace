import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
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

suite('Visual File History webview', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  async function openHistory(): Promise<string> {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(COMMANDS.showVisualFileHistory);
    await waitFor(() => (api.getVisualFileHistoryHtml() ?? '').includes('add line three'));
    return api.getVisualFileHistoryHtml() ?? '';
  }

  test('shows every commit that touched the file, with author and message', async () => {
    const html = await openHistory();
    assert.match(html, /add line three/);
    assert.match(html, /Amy Dev/);
    assert.match(html, /first commit/);
    assert.match(html, /Raj Jadon/);
  });

  test('tags each bubble with its commit sha, for the click-to-open-commit handler', async () => {
    const html = await openHistory();
    for (const commit of manifest.commits) {
      assert.match(html, new RegExp(`data-sha="${commit.sha}"`));
    }
  });

  test('does not throw when no editor is open, even though this view has no repo-wide fallback', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.equal(vscode.window.activeTextEditor, undefined);
    await vscode.commands.executeCommand(COMMANDS.showVisualFileHistory);
  });

  test('follows the active editor after the panel has been opened once, without re-running the command', async () => {
    await openHistory();

    // Switching to the untracked file should reload the panel on its own — no history for a file
    // that was never committed, so the bubble chart empties out.
    const untrackedDoc = await vscode.workspace.openTextDocument(manifest.untrackedFile);
    await vscode.window.showTextDocument(untrackedDoc);
    await waitFor(() => (api.getVisualFileHistoryHtml() ?? '').includes('No history yet.'));

    // Switching back to the tracked file should reload it again, proving this isn't a one-shot
    // listener that only fired once.
    const trackedDoc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(trackedDoc);
    await waitFor(() => (api.getVisualFileHistoryHtml() ?? '').includes('add line three'));
  });
});
