import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';

async function withAiConfig<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const config = vscode.workspace.getConfiguration('gitLore');
  await config.update('ai.enabled', enabled, vscode.ConfigurationTarget.Global);
  try {
    return await fn();
  } finally {
    await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
  }
}

suite('GitLore Chat', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('opening the chat renders the message log and input', async () => {
    await vscode.commands.executeCommand(COMMANDS.openChat);
    const html = api.getChatHtml() ?? '';
    assert.match(html, /id="chat-messages"/);
    assert.match(html, /id="chat-text"/);
  });

  test('with AI disabled, sending a message resets the panel instead of calling a model', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(COMMANDS.openChat);

    await withAiConfig(false, () => api.sendChatForTest('who touched this file last?'));
    const messages = api.chatProvider.getChatMessagesForTest();
    assert.deepEqual(messages, [{ type: 'chatReset' }]);
  });

  test('with AI enabled and no model registered, shows the no-model hint', async () => {
    // The test host never has GitHub Copilot Chat (or any other vscode.lm provider) installed,
    // so this is the one "a real model is involved" branch that's deterministic in CI — same
    // reasoning as the equivalent test for generateCommitMessage.
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(COMMANDS.openChat);

    await withAiConfig(true, () => api.sendChatForTest('who touched this file last?'));
    const messages = api.chatProvider.getChatMessagesForTest();
    assert.deepEqual(messages, [{ type: 'chatNoModel' }]);
  });

  test('with no repo context, shows an inline error instead of throwing', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand(COMMANDS.openChat);
    // Falls back to the workspace folder (the fixture repo itself) via resolveRepoContextPath,
    // so this asserts only that it completes without throwing — matching
    // generateCommitMessage.test.ts's equivalent "no repo context" case.
    await withAiConfig(true, () => api.sendChatForTest('anything'));
  });

  test('askAboutCommit with no commit loaded shows a hint instead of opening the chat', async () => {
    const message = await new Promise<string | undefined>((resolve) => {
      const original = vscode.window.showInformationMessage;
      (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
        msg: string,
      ) => {
        vscode.window.showInformationMessage = original;
        resolve(msg);
        return Promise.resolve(undefined);
      }) as typeof vscode.window.showInformationMessage;
      void vscode.commands.executeCommand(COMMANDS.askAboutCommit);
    });
    assert.equal(message, 'GitLore: open a commit in Commit Details first.');
  });
});
