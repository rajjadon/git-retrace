import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';
import { isLoadMoreNode } from '../../src/providers/FileHistoryProvider';
import type { Commit } from '../../src/core/git/types';
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

suite('File history', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('lists every commit touching the tracked file, newest first', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    await vscode.commands.executeCommand(COMMANDS.showFileHistory);
    await waitFor(() => api.fileHistoryProvider.getChildren().length > 0);

    const commits = api.fileHistoryProvider.getChildren().filter((n): n is Commit => !isLoadMoreNode(n));
    assert.equal(commits.length, 2);
    assert.equal(commits[0]?.message, 'add line three');
    assert.equal(commits[0]?.author, 'Amy Dev');
    assert.equal(commits[1]?.message, 'first commit');
    assert.equal(commits[1]?.author, 'Raj Jadon');
  });

  test('shows no commits for an untracked file', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.untrackedFile);
    await vscode.window.showTextDocument(doc);

    await waitFor(() => api.fileHistoryProvider.getChildren().length === 0, 5000);
    assert.equal(api.fileHistoryProvider.getChildren().length, 0);
  });

  test('offers "Load more" when the cap is hit, and loading more reveals the rest', async () => {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('maxHistoryItems', 1, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand(COMMANDS.showFileHistory);
      await waitFor(() => api.fileHistoryProvider.getChildren().length > 0);

      const firstPage = api.fileHistoryProvider.getChildren();
      assert.equal(firstPage.length, 2, 'expected the one capped commit plus a "Load more" row');
      const secondRow = firstPage[1];
      assert.ok(secondRow && isLoadMoreNode(secondRow), 'expected the second row to be the "Load more" node');
      const cappedCommits = firstPage.filter((n): n is Commit => !isLoadMoreNode(n));
      assert.equal(cappedCommits.length, 1);
      assert.equal(cappedCommits[0]?.message, 'add line three');

      await vscode.commands.executeCommand(COMMANDS.loadMoreFileHistory);
      await waitFor(() => api.fileHistoryProvider.getChildren().filter((n) => !isLoadMoreNode(n)).length > 1);

      const secondPage = api.fileHistoryProvider.getChildren().filter((n): n is Commit => !isLoadMoreNode(n));
      assert.equal(secondPage.length, 2);
      assert.equal(secondPage[0]?.message, 'add line three');
      assert.equal(secondPage[1]?.message, 'first commit');
    } finally {
      await config.update('maxHistoryItems', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

suite('Copy SHA command', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
  });

  test('copies the sha when given a string', async () => {
    await vscode.commands.executeCommand(COMMANDS.copySha, 'deadbeefcafe1234');
    assert.equal(await vscode.env.clipboard.readText(), 'deadbeefcafe1234');
  });

  test('copies the sha when given a tree element', async () => {
    await vscode.commands.executeCommand(COMMANDS.copySha, { sha: 'feedface99887766' });
    assert.equal(await vscode.env.clipboard.readText(), 'feedface99887766');
  });

  test('invoked with no argument, says so instead of throwing', async () => {
    // Regression: reading `.sha` off undefined raised an unhandled rejection. The command is hidden
    // from the palette now, but a keybinding or another extension can still invoke it bare.
    await vscode.env.clipboard.writeText('untouched');
    await vscode.commands.executeCommand(COMMANDS.copySha);
    assert.equal(await vscode.env.clipboard.readText(), 'untouched');
  });
});
