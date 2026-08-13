import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { buildExplorerFixtureRepo, type ExplorerFixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS, VIEWS } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';
import type { ExplorerLeafNode, ExplorerSectionNode } from '../../src/core/explorer/buildExplorerTree';

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
});
