import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { EXTENSION_ID } from './extensionId';
import { COMMANDS } from '../../src/constants';


function hoverText(hover: vscode.Hover): string {
  return hover.contents
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n');
}

suite('Blame hover card', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
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

  test('offers a command link to explain the line with AI, scoped to just that command', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(2, 0),
    );

    assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
    const hover = hovers[0];
    assert.ok(hover, 'expected at least one hover');
    const content = hover.contents[0] as vscode.MarkdownString;
    assert.match(content.value, new RegExp(`command:${COMMANDS.explainLine}\\?`));
    assert.deepEqual(content.isTrusted, { enabledCommands: [COMMANDS.explainLine] });
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

  async function withAiConfig<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('ai.enabled', enabled, vscode.ConfigurationTarget.Global);
    try {
      return await fn();
    } finally {
      await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  }

  test('gitLore.explainLine with missing arguments shows an info message instead of throwing', async () => {
    await vscode.commands.executeCommand(COMMANDS.explainLine);
  });

  test('gitLore.explainLine with AI disabled shows the settings prompt and leaves the store empty', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);

    const original = vscode.window.showInformationMessage;
    let calledWith: string | undefined;
    (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
      message: string,
      ..._rest: unknown[]
    ) => {
      calledWith = message;
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showInformationMessage;

    try {
      await withAiConfig(false, () =>
        Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
      );
    } finally {
      vscode.window.showInformationMessage = original;
    }

    assert.equal(calledWith, 'GitLore: AI features are disabled.');
    assert.equal(await api.getLineExplanationStateForTest(manifest.trackedFile, commit.sha, 'line three'), undefined);
  });

  test('gitLore.explainLine with AI enabled and no model registered stores noModel, and the next hover shows it', async () => {
    // The test host never has GitHub Copilot Chat (or any other vscode.lm provider) installed,
    // so this is the one "a real model is involved" branch that's actually deterministic in CI.
    const commit = manifest.commits[0];
    assert.ok(commit);

    await withAiConfig(true, () =>
      Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
    );

    assert.deepEqual(await api.getLineExplanationStateForTest(manifest.trackedFile, commit.sha, 'line three'), {
      status: 'noModel',
    });

    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(2, 0),
    );
    assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
    const text = hovers.map(hoverText).join('\n');
    assert.match(text, /No language model available/);
  });

  test('BlameHoverProvider returns a MarkdownString with supportThemeIcons enabled so codicons render correctly', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(2, 0),
    );

    assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
    const content = hovers[0]?.contents[0] as vscode.MarkdownString;
    assert.equal(content.supportThemeIcons, true);
  });

  test('gitLore.explainLine auto-reopens the hover when the cursor is still on the explained line', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);

    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    const editor = await vscode.window.showTextDocument(doc);
    // Position cursor on line 2 (0-indexed) — "line three" — the line being explained.
    editor.selection = new vscode.Selection(2, 0, 2, 0);

    let showHoverCalled = false;
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = ((
      cmd: string,
      ...args: unknown[]
    ) => {
      if (cmd === 'editor.action.showHover') {
        showHoverCalled = true;
        return Promise.resolve(undefined);
      }
      return originalExecuteCommand(cmd, ...args);
    }) as typeof vscode.commands.executeCommand;

    try {
      await withAiConfig(true, () =>
        Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
      );
    } finally {
      (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;
    }

    assert.ok(showHoverCalled, 'expected editor.action.showHover to be invoked when cursor is still on the explained line');
  });

  test('gitLore.explainLine shows a notification when the cursor has moved off the explained line', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);

    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    const editor = await vscode.window.showTextDocument(doc);
    // Cursor on line 0 ("line one") — NOT the line being explained ("line three" at line 2).
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    let notificationMessage: string | undefined;
    const originalShowInfo = vscode.window.showInformationMessage;
    (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
      message: string,
      ..._rest: unknown[]
    ) => {
      notificationMessage = message;
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showInformationMessage;

    let showHoverCalled = false;
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = ((
      cmd: string,
      ...args: unknown[]
    ) => {
      if (cmd === 'editor.action.showHover') {
        showHoverCalled = true;
        return Promise.resolve(undefined);
      }
      return originalExecuteCommand(cmd, ...args);
    }) as typeof vscode.commands.executeCommand;

    try {
      await withAiConfig(true, () =>
        Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
      );
    } finally {
      vscode.window.showInformationMessage = originalShowInfo;
      (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;
    }

    assert.match(notificationMessage ?? '', /hover the line again/);
    assert.ok(!showHoverCalled, 'expected editor.action.showHover NOT to be invoked when cursor has moved');
  });

  test('gitLore.explainLine recovers to an error state instead of leaving the entry stuck at pending when git fails', async () => {
    // A sha absent from the fixture repo: GitService.getCommit/getCommitDiff throw GitCommandError
    // for it (real git, no mocking needed — `git show` on a nonexistent revision fails
    // deterministically). Before the try/catch added around explain()'s body, this propagated out
    // of explain() uncaught, leaving the entry stuck at 'pending' forever — the key was already
    // marked pending before this call, 'pending' renders with no retry link, and explain()'s own
    // guard (`if (existing?.status === 'pending') return;`) silently no-ops any retry attempt too.
    // AI must be enabled for this call to reach the git fetch at all — the disabled gate now runs
    // before any git call (see LineExplanationService.explain()), so with AI off this would never
    // hit the git error this test exercises.
    const badSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    await withAiConfig(true, () =>
      Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, badSha, 'line three')),
    );

    const state = await api.getLineExplanationStateForTest(manifest.trackedFile, badSha, 'line three');
    assert.equal(state?.status, 'error');
  });
});
