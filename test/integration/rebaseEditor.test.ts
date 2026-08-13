import * as assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { CONFIG } from '../../src/constants';
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

suite('Interactive Rebase Editor', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;
  let todoPath: string;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();

    const rebaseMergeDir = join(manifest.repoRoot, '.git', 'rebase-merge');
    mkdirSync(rebaseMergeDir, { recursive: true });
    todoPath = join(rebaseMergeDir, 'git-rebase-todo');
  });

  suiteTeardown(() => {
    rmSync(join(manifest.repoRoot, '.git', 'rebase-merge'), { recursive: true, force: true });
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('opening a git-rebase-todo file uses GitLore\'s editor automatically, by file pattern alone', async () => {
    writeFileSync(todoPath, 'pick a1b2c3d first commit\npick 4e5f6a7 second commit\n');

    // No explicit viewType — this is exactly how git itself opens the file, so this proves the
    // customEditors `selector`/`priority` registration actually matches, not just that the
    // provider works when asked for by name.
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(todoPath));
    await waitFor(() => (api.getRebaseEditorHtml() ?? '').includes('a1b2c3d'));

    const html = api.getRebaseEditorHtml() ?? '';
    assert.match(html, /a1b2c3d/);
    assert.match(html, /first commit/);
    assert.match(html, /4e5f6a7/);
    assert.match(html, /second commit/);
    assert.match(html, /2 commits to rebase/);
  });

  test('an external edit to the document is reflected in the rendered editor', async () => {
    writeFileSync(todoPath, 'pick a1b2c3d first commit\n');
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(todoPath));
    await waitFor(() => (api.getRebaseEditorHtml() ?? '').includes('a1b2c3d'));

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(todoPath));
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    edit.replace(doc.uri, fullRange, 'pick 9988776 a completely different commit\n');
    await vscode.workspace.applyEdit(edit);

    await waitFor(() => (api.getRebaseEditorHtml() ?? '').includes('9988776'));
    const html = api.getRebaseEditorHtml() ?? '';
    assert.match(html, /9988776/);
    assert.match(html, /a completely different commit/);
    assert.ok(!html.includes('a1b2c3d'), 'stale content from before the edit should be gone');
  });

  test('gitLore.rebaseEditor.enabled = false falls back to the default text editor', async () => {
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    await config.update(CONFIG.rebaseEditorEnabled, false, vscode.ConfigurationTarget.Global);
    try {
      writeFileSync(todoPath, 'pick a1b2c3d first commit\n');
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(todoPath));
      await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === todoPath);

      // A plain text editor populates activeTextEditor; GitLore's webview-based custom editor does not.
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, todoPath);
      assert.equal(readFileSync(todoPath, 'utf8'), 'pick a1b2c3d first commit\n');
    } finally {
      await config.update(CONFIG.rebaseEditorEnabled, undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
