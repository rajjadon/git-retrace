import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitRetraceTestApi } from '../../src/extension';

const EXTENSION_ID = 'rajjadon.git-retrace';

/** Polls until `predicate` is true — a defined-but-stale value (e.g. the previous line's
 * label, still set from the initial editor-open) must not be mistaken for "updated". */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite('Inline blame decoration', () => {
  let manifest: FixtureManifest;
  let api: GitRetraceTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitRetraceTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('shows the current line\'s author/age on a tracked file', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    const editor = await vscode.window.showTextDocument(doc);
    const line = 2; // "line three", authored by Amy Dev
    editor.selection = new vscode.Selection(line, 0, line, 0);

    await waitFor(() => api.blameProvider.getRenderedLabel(doc.uri)?.includes('Amy Dev') ?? false);
    assert.match(api.blameProvider.getRenderedLabel(doc.uri) ?? '', /Amy Dev/);
  });

  test('shows no decoration for an untracked file', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.untrackedFile);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    // Give the (non-existent) blame lookup a moment to resolve, then confirm it stayed empty.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(api.blameProvider.getRenderedLabel(doc.uri), undefined);
  });

  test('respects gitRetrace.maxBlameFileSize by skipping oversized files', async () => {
    const config = vscode.workspace.getConfiguration('gitRetrace');
    await config.update('maxBlameFileSize', 1, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.equal(api.blameProvider.getRenderedLabel(doc.uri), undefined);
    } finally {
      await config.update('maxBlameFileSize', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
