import * as assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import * as vscode from 'vscode';
import { buildCoChangeFixtureRepo, type CoChangeFixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { EXTENSION_ID } from './extensionId';
import { COMMANDS } from '../../src/constants';
import { buildCoChangeQuickPickItems } from '../../src/commands/coChangeCommands';

async function waitForCoChangeLens(uri: vscode.Uri, attempts = 10, delayMs = 300): Promise<vscode.CodeLens | undefined> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
    const found = lenses?.find((l) => l.command?.command === COMMANDS.showCoChangedFiles);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return undefined;
}

suite('Co-change CodeLens', () => {
  let manifest: CoChangeFixtureManifest;

  suiteSetup(async () => {
    manifest = buildCoChangeFixtureRepo();
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
  });

  test('flags coupled.ts (80% coupling) but not uncoupled.ts (20% coupling)', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.mainFile);
    await vscode.window.showTextDocument(doc);

    const lens = await waitForCoChangeLens(doc.uri);
    assert.ok(lens, 'expected a co-change lens on main.ts');
    assert.match(lens.command?.title ?? '', /coupled\.ts/);
    assert.ok(!(lens.command?.title ?? '').includes('uncoupled.ts'), 'uncoupled.ts is under the coupling floor, must not appear');
  });

  test('the lens command carries the repo root and the ranked coupled-file list as arguments', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.mainFile);
    await vscode.window.showTextDocument(doc);

    const lens = await waitForCoChangeLens(doc.uri);
    assert.ok(lens?.command);
    const [repoRoot, coChanged] = lens.command.arguments as [string, { path: string; coChanges: number; totalCommits: number; coupling: number }[]];
    assert.ok(repoRoot.length > 0);
    assert.deepEqual(coChanged, [{ path: 'coupled.ts', coChanges: 4, totalCommits: 5, coupling: 0.8 }]);
  });

  test('gitLore.coChange.enabled = false suppresses the lens', async () => {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('coChange.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.mainFile);
      await vscode.window.showTextDocument(doc);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri);
      assert.ok(!(lenses ?? []).some((l) => l.command?.command === COMMANDS.showCoChangedFiles));
    } finally {
      await config.update('coChange.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('gitLore.showCoChangedFiles opens the picked file', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.mainFile);
    await vscode.window.showTextDocument(doc);
    const lens = await waitForCoChangeLens(doc.uri);
    assert.ok(lens?.command);
    const [repoRoot, coChanged] = lens.command.arguments as [string, unknown[]];

    const items = buildCoChangeQuickPickItems(coChanged as Parameters<typeof buildCoChangeQuickPickItems>[0]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.label, 'coupled.ts');

    const original = vscode.window.showQuickPick;
    (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = async () => items[0];
    try {
      await vscode.commands.executeCommand(COMMANDS.showCoChangedFiles, repoRoot, coChanged);
    } finally {
      (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = original;
    }

    // Realpath both sides before comparing: the command opens the file via a repo root git itself
    // canonicalized (macOS resolves `/var/folders` -> `/private/var/folders`), while the fixture's
    // own path is the raw, non-canonicalized form — same file, two equally correct spellings.
    assert.equal(realpathSync(vscode.window.activeTextEditor?.document.uri.fsPath ?? ''), realpathSync(manifest.coupledFile));
  });
});
