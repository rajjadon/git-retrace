import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';

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

suite('Generate changelog with AI', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
  });

  test('with no repo context, says so instead of throwing', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // Falls back to the workspace folder (the fixture repo), so a QuickPick opens instead of the
    // "open a repo first" message. Stub it to resolve immediately (same pattern launchpad.test.ts
    // uses for showInputBox) so the command returns instead of hanging on unattended user input —
    // this asserts only that invoking the command doesn't throw.
    const originalQuickPick = vscode.window.showQuickPick;
    (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = (async () =>
      undefined) as typeof vscode.window.showQuickPick;
    try {
      await captureInfoMessage(() => Promise.resolve(vscode.commands.executeCommand(COMMANDS.generateChangelog)));
    } finally {
      vscode.window.showQuickPick = originalQuickPick;
    }
  });
});
