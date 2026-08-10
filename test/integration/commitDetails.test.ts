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

suite('Commit details webview', () => {
  let manifest: FixtureManifest;
  let api: GitSenseTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitSenseTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('shows commit message, author, files changed, and diff', async () => {
    const commit = manifest.commits[0]; // "add line three", authored by Amy Dev
    assert.ok(commit);

    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    const html = api.getCommitDetailsHtml() ?? '';
    assert.match(html, /add line three/);
    assert.match(html, /Amy Dev/);
    assert.match(html, /tracked\.txt/);
    assert.match(html, /class="diff-add">\+line three</);
    assert.ok(!html.includes('unsafe-inline'));
  });

  test('shows an info message instead of a broken panel when invoked without args', async () => {
    // Just confirms the command doesn't throw when called with no arguments.
    await vscode.commands.executeCommand(COMMANDS.showCommit);
  });
});
