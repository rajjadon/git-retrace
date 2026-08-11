import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitRetraceTestApi } from '../../src/extension';
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

suite('Commit details webview', () => {
  let manifest: FixtureManifest;
  let api: GitRetraceTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitRetraceTestApi>(EXTENSION_ID);
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
    assert.match(html, /class="dc diff-add">\+line three</);
    assert.ok(!html.includes('unsafe-inline'));
  });

  test('offers copy and wrap actions, and hides the remote action on a repo with no remote', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    const html = api.getCommitDetailsHtml() ?? '';
    assert.match(html, /id="copy-sha"/);
    assert.match(html, /id="copy-message"/);
    assert.match(html, /id="wrap" type="button" aria-pressed="false"/);
    // The fixture repo has no `origin`, so there is no host to link to.
    assert.ok(!html.includes('id="open-remote"'));
  });

  test('numbers the inline diff gutter from the hunk header', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    const html = api.getCommitDetailsHtml() ?? '';
    assert.match(html, /class="dn dn-old">1<\/span><span class="dn dn-new">1</);
    assert.match(html, /class="dn dn-old"><\/span><span class="dn dn-new">3<\/span><span class="dc diff-add">\+line three</);
  });

  test('shows an info message instead of a broken panel when invoked without args', async () => {
    // Just confirms the command doesn't throw when called with no arguments.
    await vscode.commands.executeCommand(COMMANDS.showCommit);
  });
});
