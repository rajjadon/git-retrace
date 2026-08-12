import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { buildOwnershipFixtureRepo, type OwnershipFixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
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

suite('Ownership heatmap', () => {
  let manifest: OwnershipFixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = buildOwnershipFixtureRepo();
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('lines from the same author land in the same color bucket; a different author lands in a different one', async () => {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('ownership.enabled', true, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
      await vscode.window.showTextDocument(doc);

      await waitFor(() => api.ownershipProvider.getOwnershipRangesForTest(doc.uri).some((lines) => lines.length > 0));

      const buckets = api.ownershipProvider.getOwnershipRangesForTest(doc.uri);
      const bucketOf = (line: number): number => buckets.findIndex((lines) => lines.includes(line));

      assert.equal(bucketOf(0), bucketOf(1)); // both Alice's lines
      assert.notEqual(bucketOf(0), bucketOf(2)); // Bob's line differs
      assert.notEqual(bucketOf(2), -1, 'expected line 2 (Bob\'s) to be in some color bucket');
    } finally {
      await config.update('ownership.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('gitLore.ownership.enabled = false (the default) means no ruler marks at all', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    const buckets = api.ownershipProvider.getOwnershipRangesForTest(doc.uri);
    assert.equal(buckets.length, 7, 'expected 7 populated-but-empty color buckets, not an absent/empty top-level array');
    assert.ok(buckets.every((lines) => lines.length === 0));
  });

  test('gitLore.showFileOwnership: lists authors most-recently-active first, with recency-weighted percentages', async () => {
    const items = await api.getOwnershipItemsForTest(manifest.trackedFile);
    assert.ok(items);
    assert.equal(items.length, 2);

    assert.equal(items[0]?.label, 'Bob Smith'); // more recent commit — listed first
    assert.equal(items[1]?.label, 'Alice Dev');

    const bobPercentage = Number((items[0]?.description ?? '0%').replace('%', ''));
    const alicePercentage = Number((items[1]?.description ?? '0%').replace('%', ''));
    // Alice has 2 of 3 raw lines (66.7%) but her commit is older; Bob has 1 of 3 (33.3%) but is
    // more recent. Recency-weighting must pull Bob's share above his raw line count and Alice's
    // below hers — proving the ranking isn't just counting lines.
    assert.ok(bobPercentage > 34, `expected Bob's recency-weighted share (${bobPercentage}%) above his raw 33.3% line share`);
    assert.ok(alicePercentage < 66, `expected Alice's recency-weighted share (${alicePercentage}%) below her raw 66.7% line share`);
  });

  test('gitLore.showFileOwnership: returns null for a file with no blame data', async () => {
    const items = await api.getOwnershipItemsForTest('/no/such/file.txt');
    assert.equal(items, null);
  });
});
