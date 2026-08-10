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

suite('File history', () => {
  let manifest: FixtureManifest;
  let api: GitSenseTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitSenseTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('lists every commit touching the tracked file, newest first', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    await vscode.commands.executeCommand(COMMANDS.showFileHistory);
    await waitFor(() => api.fileHistoryProvider.getChildren().length > 0);

    const commits = api.fileHistoryProvider.getChildren();
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
});

suite('Copy SHA command', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitSenseTestApi>(EXTENSION_ID);
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
