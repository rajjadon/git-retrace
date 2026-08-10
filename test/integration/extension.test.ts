import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'gitsense-dev.gitsense';

suite('Extension activation', () => {
  test('activates and registers gitsense.toggleBlame', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'extension not found — check the publisher.name id in package.json');
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('gitsense.toggleBlame'), 'gitsense.toggleBlame was not registered');
  });
});
