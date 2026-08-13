import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { buildOwnershipFixtureRepo, type OwnershipFixtureManifest } from '../fixtures/build-fixture-repo';
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

suite('Full-file blame heatmap', () => {
  let manifest: OwnershipFixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = buildOwnershipFixtureRepo();
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('gitLore.fullFileBlame.enabled = false (the default) means no gradient marks at all', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    const buckets = api.fullFileBlameProvider.getRecencyRangesForTest(doc.uri);
    assert.equal(buckets.length, 5, 'expected 5 populated-but-empty recency buckets, not an absent/empty top-level array');
    assert.ok(buckets.every((lines) => lines.length === 0));
  });

  test('the more recent line lands in a hotter (lower-index) bucket than the older lines', async () => {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('fullFileBlame.enabled', true, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
      await vscode.window.showTextDocument(doc);

      await waitFor(() => api.fullFileBlameProvider.getRecencyRangesForTest(doc.uri).some((lines) => lines.length > 0));

      const buckets = api.fullFileBlameProvider.getRecencyRangesForTest(doc.uri);
      const bucketOf = (line: number): number => buckets.findIndex((lines) => lines.includes(line));

      // Alice's lines (0, 1) are from the older commit; Bob's line (2) is the more recent one.
      assert.equal(bucketOf(0), bucketOf(1));
      assert.ok(bucketOf(2) < bucketOf(0), `expected Bob's more recent line (bucket ${bucketOf(2)}) hotter than Alice's (bucket ${bucketOf(0)})`);
    } finally {
      await config.update('fullFileBlame.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('gitLore.toggleFullFileBlame flips the decorations on and off', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    assert.ok(api.fullFileBlameProvider.getRecencyRangesForTest(doc.uri).every((lines) => lines.length === 0));

    await vscode.commands.executeCommand(COMMANDS.toggleFullFileBlame);
    await waitFor(() => api.fullFileBlameProvider.getRecencyRangesForTest(doc.uri).some((lines) => lines.length > 0));

    await vscode.commands.executeCommand(COMMANDS.toggleFullFileBlame);
    await waitFor(() => api.fullFileBlameProvider.getRecencyRangesForTest(doc.uri).every((lines) => lines.length === 0));
  });
});
