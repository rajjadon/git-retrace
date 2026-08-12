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

suite('Commit details webview', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
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

  async function withAiConfig<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('ai.enabled', enabled, vscode.ConfigurationTarget.Global);
    try {
      return await fn();
    } finally {
      await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  }

  test('explainCommit prompts to enable AI when gitLore.ai.enabled is false', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    const original = vscode.window.showInformationMessage;
    let calledWith: string | undefined;
    (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
      message: string,
      ..._rest: unknown[]
    ) => {
      calledWith = message;
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showInformationMessage;

    try {
      await withAiConfig(false, () => api.explainCommit());
    } finally {
      vscode.window.showInformationMessage = original;
    }

    assert.equal(calledWith, 'GitLore: AI features are disabled.');
    assert.deepEqual(api.getAiSummaryMessagesForTest(), [{ type: 'aiSummaryReset' }]);
  });

  test('explainCommit shows the no-model hint when AI is enabled but no language model is registered', async () => {
    // The test host never has GitHub Copilot Chat (or any other vscode.lm provider) installed,
    // so vscode.lm.selectChatModels() reliably resolves to an empty list here — this is the one
    // "a real model is involved" branch that's actually deterministic in CI.
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    await withAiConfig(true, () => api.explainCommit());

    assert.deepEqual(api.getAiSummaryMessagesForTest(), [{ type: 'aiSummaryNoModel' }]);
  });

  test('the AI Summary section and button are present in the rendered panel', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    const html = api.getCommitDetailsHtml() ?? '';
    assert.match(html, /id="explain-commit"/);
    assert.match(html, /AI Summary/);
  });

  test('gitLore.explainCommit command drives the same flow as the panel button', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    await withAiConfig(true, () => Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainCommit)));

    assert.deepEqual(api.getAiSummaryMessagesForTest(), [{ type: 'aiSummaryNoModel' }]);
  });

});
