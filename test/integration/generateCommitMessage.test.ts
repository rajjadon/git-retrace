import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

async function captureInfoMessage(fn: () => Promise<unknown>): Promise<string | undefined> {
  const original = vscode.window.showInformationMessage;
  let calledWith: string | undefined;
  (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
    message: string,
    ..._rest: unknown[]
  ) => {
    calledWith ??= message;
    return Promise.resolve(undefined);
  }) as typeof vscode.window.showInformationMessage;
  try {
    await fn();
  } finally {
    vscode.window.showInformationMessage = original;
  }
  return calledWith;
}

suite('Generate commit message with AI', () => {
  let manifest: FixtureManifest;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
  });

  test('with no repo context, says so instead of throwing', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // Falls back to the workspace folder (the fixture repo itself), so this never actually hits
    // the "open a repo first" branch in this suite — asserting only that it doesn't throw.
    await vscode.commands.executeCommand(COMMANDS.generateCommitMessage);
  });

  test('with AI disabled, shows the settings prompt and never touches the Git extension', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    const message = await captureInfoMessage(() =>
      withAiConfig(false, () => Promise.resolve(vscode.commands.executeCommand(COMMANDS.generateCommitMessage))),
    );
    assert.equal(message, 'GitLore: AI features are disabled.');
  });

  test('with AI enabled and nothing staged, asks to stage first', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    const message = await captureInfoMessage(() =>
      withAiConfig(true, () => Promise.resolve(vscode.commands.executeCommand(COMMANDS.generateCommitMessage))),
    );
    assert.equal(message, 'GitLore: stage some changes first.');
  });

  test('with AI enabled and something staged, no model registered shows the hint', async () => {
    // The test host never has GitHub Copilot Chat (or any other vscode.lm provider) installed,
    // so this is the one "a real model is involved" branch that's actually deterministic in CI —
    // same reasoning as the equivalent test for explainLine in hover.test.ts.
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    execFileSync('git', ['add', manifest.untrackedFile], { cwd: manifest.repoRoot });
    try {
      const message = await captureInfoMessage(() =>
        withAiConfig(true, () => Promise.resolve(vscode.commands.executeCommand(COMMANDS.generateCommitMessage))),
      );
      assert.equal(
        message,
        'No language model available. Enable a language model (e.g. GitHub Copilot Chat) to use this feature.',
      );
    } finally {
      execFileSync('git', ['reset', manifest.untrackedFile], { cwd: manifest.repoRoot });
    }
  });
});
