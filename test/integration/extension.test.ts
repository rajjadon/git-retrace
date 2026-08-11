import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { EXTENSION_ID } from './extensionId';


suite('Extension activation', () => {
  test('activates and registers gitRetrace.toggleBlame', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'extension not found — check the publisher.name id in package.json');
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('gitRetrace.toggleBlame'), 'gitRetrace.toggleBlame was not registered');
  });
});
