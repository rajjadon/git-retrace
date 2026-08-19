import * as assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { buildExplorerFixtureRepo, type ExplorerFixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS, SYNC_TERMINAL_NAME, VIEWS } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';
import type { ExplorerLeafNode, ExplorerSectionNode } from '../../src/core/explorer/buildExplorerTree';
import type { ReflogEntry } from '../../src/core/git/types';

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite('Sidebar Explorer', () => {
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  /**
   * Opens the fixture's tracked file so `resolveRepoContextPath()` resolves to this isolated repo
   * (not the shared workspace one) for commands under test, then refreshes the provider directly
   * and awaits it — the `onDidChangeActiveTextEditor` watcher would do this too, but racing that
   * event is pointless: `sections` already holds 6 entries from a previous suite's refresh, so a
   * `getChildren().length === 6` poll would resolve instantly against stale data.
   */
  async function openExplorerFor(fixture: ExplorerFixtureManifest): Promise<ExplorerSectionNode[]> {
    const doc = await vscode.workspace.openTextDocument(fixture.trackedFile);
    await vscode.window.showTextDocument(doc);
    await api.repoExplorerProvider.refresh(fixture.trackedFile);
    return api.repoExplorerProvider.getChildren() as ExplorerSectionNode[];
  }

  function section(sections: ExplorerSectionNode[], id: string): ExplorerSectionNode {
    const found = sections.find((s) => s.id === id);
    assert.ok(found, `no '${id}' section in ${sections.map((s) => s.id).join(', ')}`);
    return found;
  }

  function findBranch(sections: ExplorerSectionNode[], name: string): ExplorerLeafNode {
    const node = section(sections, 'branches').children.find((n) => n.kind === 'branch' && n.branch.name === name);
    assert.ok(node, `no branch node named '${name}'`);
    return node;
  }

  test('registers the gitLore.explorer view and all context-menu commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      COMMANDS.checkoutBranch,
      COMMANDS.compareBranchFromExplorer,
      COMMANDS.mergeBranchFromExplorer,
      COMMANDS.rebaseOntoBranchFromExplorer,
      COMMANDS.openRemote,
      COMMANDS.applyStash,
      COMMANDS.dropStash,
    ]) {
      assert.ok(commands.includes(id), `${id} was not registered`);
    }
    // Proves the view id is actually wired to a live provider, not just declared in package.json.
    await vscode.commands.executeCommand(`${VIEWS.explorer}.focus`);
  });

  test('builds all six sections with branches, tags, and stashes from the fixture repo', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);

    assert.deepEqual(sections.map((s) => s.label), ['Branches', 'Remotes', 'Tags', 'Stashes', 'Worktrees', 'Contributors']);

    const branches = section(sections, 'branches').children;
    const branchNames = branches.map((n) => (n.kind === 'branch' ? n.branch.name : null));
    assert.ok(branchNames.includes(fixture.currentBranch));
    assert.ok(branchNames.includes(fixture.otherBranch));
    const current = findBranch(sections, fixture.currentBranch);
    assert.equal(current.kind === 'branch' && current.branch.isCurrent, true);

    const tags = section(sections, 'tags').children;
    assert.ok(tags.some((n) => n.kind === 'tag' && n.tag.name === fixture.tagName));

    const stashes = section(sections, 'stashes').children;
    assert.equal(stashes.length, 1);
    assert.ok(stashes[0]?.kind === 'stash' && stashes[0].stash.message.includes(fixture.stashMessage));

    const contributors = section(sections, 'contributors').children;
    assert.ok(contributors.some((n) => n.kind === 'contributor' && n.contributor.name === 'Raj Jadon'));
    assert.ok(contributors.some((n) => n.kind === 'contributor' && n.contributor.name === 'Amy Dev'));

    const worktrees = section(sections, 'worktrees').children;
    assert.equal(worktrees.length, 1);
    assert.ok(worktrees[0]?.kind === 'worktree' && worktrees[0].worktree.isMain);
  });

  test('empty sections start collapsed; populated sections start expanded, both with an icon', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);

    const branchesItem = api.repoExplorerProvider.getTreeItem(section(sections, 'branches'));
    assert.equal(branchesItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.equal((branchesItem.iconPath as vscode.ThemeIcon).id, 'git-branch');

    // The fixture has no configured remote, so Remotes is the empty one here.
    const remotesItem = api.repoExplorerProvider.getTreeItem(section(sections, 'remotes'));
    assert.equal(remotesItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.equal((remotesItem.iconPath as vscode.ThemeIcon).id, 'cloud');
    assert.equal(remotesItem.description, '0');
  });

  test('a worktree item shows the folder name (not the full path) as its label, with the full path as a tooltip', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const worktreeNode = section(sections, 'worktrees').children[0];
    assert.ok(worktreeNode?.kind === 'worktree');

    const item = api.repoExplorerProvider.getTreeItem(worktreeNode);
    assert.equal(item.label, worktreeNode.worktree.path.split('/').pop());
    assert.equal(item.tooltip, worktreeNode.worktree.path);
    assert.match(String(item.description), /\(main\)/);
  });

  test('a remote-tracking branch gets the cloud icon, matching the Remotes section', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    // Local branches only in this fixture — build a synthetic remote-tracking node to check the
    // icon-selection logic directly, since the fixture repo has no remote configured.
    const localBranch = findBranch(sections, fixture.currentBranch);
    assert.ok(localBranch.kind === 'branch');
    const remoteBranchNode: typeof localBranch = {
      kind: 'branch',
      branch: { ...localBranch.branch, name: `origin/${fixture.currentBranch}`, isRemote: true, isCurrent: false },
    };
    const item = api.repoExplorerProvider.getTreeItem(remoteBranchNode);
    assert.equal((item.iconPath as vscode.ThemeIcon).id, 'cloud');
    assert.equal(item.contextValue, 'gitLore.branch.remote');
  });

  test('a contributor item shows their email as a tooltip', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const contributorNode = section(sections, 'contributors').children.find((n) => n.kind === 'contributor');
    assert.ok(contributorNode?.kind === 'contributor');

    const item = api.repoExplorerProvider.getTreeItem(contributorNode);
    assert.equal(item.tooltip, contributorNode.contributor.email);
  });

  test('gitLore.checkoutBranch switches the current branch', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    // The command handler awaits `explorer.refreshCurrent()` itself before returning, so there's
    // nothing to poll for — by the time `executeCommand` resolves, the tree already reflects it.
    await vscode.commands.executeCommand(COMMANDS.checkoutBranch, branchNode);

    const current = await api.git.getCurrentBranch(fixture.trackedFile);
    assert.equal(current, fixture.otherBranch);

    const refreshedBranch = findBranch(api.repoExplorerProvider.getChildren() as ExplorerSectionNode[], fixture.otherBranch);
    assert.equal(refreshedBranch.kind === 'branch' && refreshedBranch.branch.isCurrent, true);
  });

  test('gitLore.compareBranchFromExplorer opens the branch comparison view against the current branch', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    await vscode.commands.executeCommand(COMMANDS.compareBranchFromExplorer, branchNode);
    await waitFor(() => (api.getBranchComparisonHtml() ?? '').includes('add feature line'));
    const html = api.getBranchComparisonHtml() ?? '';
    assert.match(html, /add feature line/);
  });

  test('gitLore.mergeBranchFromExplorer opens the shared Git Sync terminal after confirmation', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Merge';
    try {
      await vscode.commands.executeCommand(COMMANDS.mergeBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    assert.ok(vscode.window.terminals.some((t) => t.name === SYNC_TERMINAL_NAME));
  });

  test('gitLore.rebaseOntoBranchFromExplorer opens the shared Git Sync terminal after confirmation', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Rebase';
    try {
      await vscode.commands.executeCommand(COMMANDS.rebaseOntoBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    assert.ok(vscode.window.terminals.some((t) => t.name === SYNC_TERMINAL_NAME));
  });

  test('gitLore.mergeBranchFromExplorer and gitLore.rebaseOntoBranchFromExplorer are no-ops when the confirm dialog is dismissed', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);
    const before = vscode.window.terminals.length;

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => undefined;
    try {
      await vscode.commands.executeCommand(COMMANDS.mergeBranchFromExplorer, branchNode);
      await vscode.commands.executeCommand(COMMANDS.rebaseOntoBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    assert.equal(vscode.window.terminals.length, before);
  });

  test('gitLore.openRemote is a silent no-op when the remote URL cannot be parsed', async () => {
    // No exception, no crash — this is the only branch safely observable without launching a
    // real external browser mid-test-run.
    await vscode.commands.executeCommand(COMMANDS.openRemote, { kind: 'remote', remote: { name: 'origin', url: 'not-a-url' } });
  });

  test('gitLore.applyStash re-applies a stash without dropping it', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const stashNode = section(sections, 'stashes').children[0];
    assert.ok(stashNode?.kind === 'stash');

    // The handler awaits `git.applyStash` and `explorer.refreshCurrent()` before returning, so
    // both the working tree and the tree data are already settled once `executeCommand` resolves.
    await vscode.commands.executeCommand(COMMANDS.applyStash, stashNode);

    assert.ok(readFileSync(fixture.trackedFile, 'utf8').includes('uncommitted change'));
    const stashesAfter = await api.git.getStashes(fixture.trackedFile);
    assert.equal(stashesAfter.length, 1, 'apply must not drop the stash');
  });

  test('gitLore.dropStash requires confirmation and then removes the stash', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const stashNode = section(sections, 'stashes').children[0];
    assert.ok(stashNode?.kind === 'stash');

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Delete';
    try {
      await vscode.commands.executeCommand(COMMANDS.dropStash, stashNode);
      const stashesAfter = await api.git.getStashes(fixture.trackedFile);
      assert.equal(stashesAfter.length, 0);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }
  });

  test('gitLore.renameBranchFromExplorer renames a local branch after prompting for the new name', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => 'renamed-branch';
    try {
      await vscode.commands.executeCommand(COMMANDS.renameBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(branches.some((b) => b.name === 'renamed-branch'), 'renamed branch not found');
    assert.ok(!branches.some((b) => b.name === fixture.otherBranch), 'old branch name still present');
  });

  test('gitLore.deleteBranchFromExplorer requires confirmation and then deletes a local branch', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Delete';
    try {
      await vscode.commands.executeCommand(COMMANDS.deleteBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(!branches.some((b) => b.name === fixture.otherBranch), 'branch was not deleted');
  });

  test('gitLore.deleteBranchFromExplorer is a no-op when the confirm dialog is dismissed', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => undefined;
    try {
      await vscode.commands.executeCommand(COMMANDS.deleteBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(branches.some((b) => b.name === fixture.otherBranch), 'branch must survive a dismissed confirm');
  });

  test('gitLore.deleteTagFromExplorer requires confirmation and then deletes the tag', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const tagNode = section(sections, 'tags').children.find((n) => n.kind === 'tag' && n.tag.name === fixture.tagName);
    assert.ok(tagNode, `no tag node named '${fixture.tagName}'`);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Delete';
    try {
      await vscode.commands.executeCommand(COMMANDS.deleteTagFromExplorer, tagNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const tags = await api.git.getTags(fixture.trackedFile);
    assert.ok(!tags.some((t) => t.name === fixture.tagName), 'tag was not deleted');
  });

  test('gitLore.addWorktreeFromExplorer creates a worktree at a chosen path and branch', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const worktreesSection = section(sections, 'worktrees');

    const worktreePath = join(dirname(fixture.repoRoot), `wt-${Date.now()}`);
    const originalInputBox = vscode.window.showInputBox;
    let call = 0;
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => (call++ === 0 ? worktreePath : fixture.otherBranch);
    try {
      await vscode.commands.executeCommand(COMMANDS.addWorktreeFromExplorer, worktreesSection);
    } finally {
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    // `git worktree list --porcelain` reports the realpath (macOS's tmpdir is a symlink,
    // /var/folders -> /private/var/folders) — canonicalize before comparing, same fix
    // coChangeLens.test.ts already applies for the same symlink mismatch.
    const worktrees = await api.git.getWorktrees(fixture.trackedFile);
    assert.ok(worktrees.some((w) => w.path === realpathSync(worktreePath)), 'new worktree not found');
  });

  test('gitLore.removeWorktreeFromExplorer requires confirmation and then removes a linked worktree', async () => {
    const fixture = buildExplorerFixtureRepo();
    const requestedPath = join(dirname(fixture.repoRoot), `wt-remove-${Date.now()}`);
    await api.git.addWorktree(fixture.trackedFile, requestedPath, fixture.otherBranch);
    // `git worktree list --porcelain` reports the realpath (macOS's tmpdir is a symlink,
    // /var/folders -> /private/var/folders) — canonicalize after creation, since the path
    // doesn't exist yet to canonicalize beforehand.
    const worktreePath = realpathSync(requestedPath);
    const sections = await openExplorerFor(fixture);
    const worktreeNode = section(sections, 'worktrees').children.find((n) => n.kind === 'worktree' && n.worktree.path === worktreePath);
    assert.ok(worktreeNode, 'linked worktree not found in tree');

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Remove';
    try {
      await vscode.commands.executeCommand(COMMANDS.removeWorktreeFromExplorer, worktreeNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const worktrees = await api.git.getWorktrees(fixture.trackedFile);
    assert.ok(!worktrees.some((w) => w.path === worktreePath), 'worktree was not removed');
  });

  test('gitLore.createStashFromExplorer stashes the working tree with a message', async () => {
    const fixture = buildExplorerFixtureRepo();
    // The fixture's own pre-made stash (from its manifest) already occupies index 0; make a
    // fresh, distinguishable uncommitted change so this test isn't just re-stashing that one.
    const { appendFileSync } = await import('node:fs');
    appendFileSync(fixture.trackedFile, '\nanother uncommitted change\n');
    const sections = await openExplorerFor(fixture);
    const stashesSection = section(sections, 'stashes');
    const stashesBefore = await api.git.getStashes(fixture.trackedFile);

    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => 'my new stash';
    try {
      await vscode.commands.executeCommand(COMMANDS.createStashFromExplorer, stashesSection);
    } finally {
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    const stashesAfter = await api.git.getStashes(fixture.trackedFile);
    assert.equal(stashesAfter.length, stashesBefore.length + 1);
    assert.ok(stashesAfter.some((s) => s.message.includes('my new stash')));
  });

  test('gitLore.recoverFromReflog lists reflog entries and creates a branch at the chosen one', async () => {
    const fixture = buildExplorerFixtureRepo();
    await openExplorerFor(fixture);
    const entries = await api.git.getReflog(fixture.trackedFile, 50);
    assert.ok(entries.length > 0, 'fixture repo must have reflog entries');

    const originalQuickPick = vscode.window.showQuickPick;
    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = async (items: { entry: ReflogEntry }[]) => items[0];
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => 'recovered-branch';
    try {
      await vscode.commands.executeCommand(COMMANDS.recoverFromReflog);
    } finally {
      (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = originalQuickPick;
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(branches.some((b) => b.name === 'recovered-branch'), 'recovery branch not created');
  });
});
