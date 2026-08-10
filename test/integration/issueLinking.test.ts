import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitSenseTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';

const EXTENSION_ID = 'gitsense-dev.gitsense';

function hoverText(hover: vscode.Hover): string {
  return hover.contents.map((c) => (typeof c === 'string' ? c : c.value)).join('\n');
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite('Issue linking', () => {
  let manifest: FixtureManifest;
  let api: GitSenseTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitSenseTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  // The fixture repo has no real git remote, and its commit messages have no "#N" references,
  // so these tests configure a custom pattern/template — proving the (repo-agnostic) linking
  // mechanism itself, rather than depending on fixture data shaped like a real issue reference.
  async function withIssueLinkingConfig<T>(fn: () => Promise<T>): Promise<T> {
    const config = vscode.workspace.getConfiguration('gitsense');
    await config.update('issueLinking.pattern', '(three)', vscode.ConfigurationTarget.Global);
    await config.update('issueLinking.urlTemplate', 'https://example.com/issue/{issue}', vscode.ConfigurationTarget.Global);
    try {
      return await fn();
    } finally {
      await config.update('issueLinking.pattern', undefined, vscode.ConfigurationTarget.Global);
      await config.update('issueLinking.urlTemplate', undefined, vscode.ConfigurationTarget.Global);
    }
  }

  test('links a matching reference in the blame hover card', async () => {
    await withIssueLinkingConfig(async () => {
      const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
      await vscode.window.showTextDocument(doc);

      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        doc.uri,
        new vscode.Position(2, 0), // "add line three", authored by Amy Dev
      );
      assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
      const text = hovers.map(hoverText).join('\n');
      assert.match(text, /\[three\]\(https:\/\/example\.com\/issue\/three\)/);
    });
  });

  test('links a matching reference in the commit details webview', async () => {
    await withIssueLinkingConfig(async () => {
      const commit = manifest.commits[0]; // "add line three"
      assert.ok(commit);

      await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
      await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes('example.com/issue/three'));

      const html = api.getCommitDetailsHtml() ?? '';
      assert.match(html, /<a href="https:\/\/example\.com\/issue\/three"[^>]*>three<\/a>/);
    });
  });

  test('without a configured pattern/template and no real remote, no link is added', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);

    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes('add line three'));

    const html = api.getCommitDetailsHtml() ?? '';
    assert.ok(!html.includes('<a href'));
  });
});
