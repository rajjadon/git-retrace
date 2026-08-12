import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { buildStaleFixtureRepo, type StaleFixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { EXTENSION_ID } from './extensionId';
import { COMMANDS } from '../../src/constants';

/**
 * Polls `executeCodeLensProvider` until it returns a non-empty array or `attempts` are exhausted.
 * The provider's first call triggers `vscode.executeDocumentSymbolProvider`, which can race the
 * built-in TypeScript extension's own activation for a `.ts` file opened outside any workspace
 * folder — a cold host can get `undefined`/`[]` back with no retry from VS Code itself.
 */
async function waitForCodeLenses(
  uri: vscode.Uri,
  attempts = 10,
  delayMs = 300,
): Promise<vscode.CodeLens[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    if (lenses && lenses.length > 0) {
      return lenses;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return [];
}

suite('Stale-code CodeLens', () => {
  let manifest: StaleFixtureManifest;

  suiteSetup(async () => {
    manifest = buildStaleFixtureRepo();
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();

    // Warm up the TS language server before any test asserts on lens content — see
    // waitForCodeLenses for why the very first call can otherwise come back empty.
    const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
    await vscode.window.showTextDocument(doc);
    await waitForCodeLenses(doc.uri);
  });

  test('flags a top-level function untouched since the old commit, but not one changed just now', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
    await vscode.window.showTextDocument(doc);

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri,
    );

    assert.ok(lenses, 'expected a code lens result');
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(
      titles.some((t) => t.includes('Stale')),
      `expected at least one "Stale" lens, got: ${JSON.stringify(titles)}`,
    );
    // recentlyChangedFunction was touched by the second (effectively "now") commit — never stale.
    const text = doc.getText();
    const recentLine = text.split('\n').findIndex((l) => l.includes('recentlyChangedFunction'));
    assert.ok(!lenses.some((l) => l.range.start.line === recentLine), 'recentlyChangedFunction must not be flagged');
  });

  test('flags exactly the top-level function, the class method, and the outer function — never the class itself or the nested helper', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
    await vscode.window.showTextDocument(doc);

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri,
    );
    assert.ok(lenses);

    const lines = doc.getText().split('\n');
    const lineOf = (needle: string): number => lines.findIndex((l) => l.includes(needle));
    const flaggedLines = new Set(lenses.map((l) => l.range.start.line));

    assert.ok(flaggedLines.has(lineOf('function longUnchangedFunction')), 'top-level function must be flagged');
    assert.ok(flaggedLines.has(lineOf('run()')), 'the class method must be flagged');
    assert.ok(flaggedLines.has(lineOf('function outerFunction')), 'the outer function must be flagged');
    assert.ok(!flaggedLines.has(lineOf('class OldService')), 'the class declaration itself must not be flagged');
    assert.ok(!flaggedLines.has(lineOf('function innerHelper')), 'the nested function must never be flagged');
    assert.equal(lenses.length, 3, `expected exactly 3 stale lenses, got ${lenses.length}: ${JSON.stringify(lenses.map((l) => l.command?.title))}`);
  });

  test('a stale lens opens Commit Details for the commit that made it stale', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
    await vscode.window.showTextDocument(doc);

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri,
    );
    assert.ok(lenses && lenses.length > 0);
    const lens = lenses[0];
    assert.ok(lens?.command);
    assert.equal(lens.command.command, COMMANDS.showCommit);
    assert.deepEqual(lens.command.arguments, [manifest.staleFile, manifest.staleSha]);
  });

  test('gitLore.staleCode.enabled = false suppresses every lens', async () => {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('staleCode.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
      await vscode.window.showTextDocument(doc);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        doc.uri,
      );
      assert.equal(lenses?.length ?? 0, 0);
    } finally {
      await config.update('staleCode.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
