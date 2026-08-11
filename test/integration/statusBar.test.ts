import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitRetraceTestApi } from '../../src/extension';

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

suite('Status bar', () => {
  let manifest: FixtureManifest;
  let api: GitRetraceTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitRetraceTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('mirrors the current line\'s author/age', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    const editor = await vscode.window.showTextDocument(doc);
    const line = 2; // "line three", authored by Amy Dev
    editor.selection = new vscode.Selection(line, 0, line, 0);

    await waitFor(() => api.statusBarProvider.getTextForTest()?.includes('Amy Dev') ?? false);
    assert.match(api.statusBarProvider.getTextForTest() ?? '', /Amy Dev/);
  });

  test('hides for an untracked file', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.untrackedFile);
    await vscode.window.showTextDocument(doc);

    await waitFor(() => api.statusBarProvider.getTextForTest() === undefined, 5000);
    assert.equal(api.statusBarProvider.getTextForTest(), undefined);
  });
});
