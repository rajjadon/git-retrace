import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { EXTENSION_ID } from './extensionId';


function hoverText(hover: vscode.Hover): string {
  return hover.contents
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n');
}

suite('Blame hover card', () => {
  let manifest: FixtureManifest;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
  });

  test('shows author, message, gravatar, and diff stat for a tracked line', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(2, 0), // "line three", authored by Amy Dev
    );

    assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
    const text = hovers.map(hoverText).join('\n');
    assert.match(text, /Amy Dev/);
    assert.match(text, /add line three/);
    assert.match(text, /gravatar\.com\/avatar\//);
    assert.match(text, /\+1 -0/); // this commit only added "line three"
  });

  test('shows no hover for an untracked file', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.untrackedFile);
    await vscode.window.showTextDocument(doc);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(0, 0),
    );

    assert.equal(hovers?.length ?? 0, 0);
  });
});
