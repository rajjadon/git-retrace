import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import { GitCommandError } from '../core/git/errors';
import { parseRemoteUrl } from '../core/git/parsers';
import { buildRepoUrl } from '../utils/remoteLinks';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import { runInGitSyncTerminal } from '../views/gitSyncTerminal';
import type { RepoExplorerProvider } from '../providers/RepoExplorerProvider';
import type { ExplorerLeafNode, ExplorerNode } from '../core/explorer/buildExplorerTree';

function errorMessage(err: unknown): string {
  return err instanceof GitCommandError ? err.stderr : err instanceof Error ? err.message : String(err);
}

export function handleCheckoutBranchCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.checkoutBranch, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.checkoutBranch(filePath, node.branch.name);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't check out '${node.branch.name}' — ${errorMessage(err)}`);
    }
  });
}

export function handleCompareBranchCommand(git: GitService): vscode.Disposable {
  // Reuses the existing Branch Comparison command/view rather than a second implementation —
  // it already accepts an optional (base, compare) pair for exactly this kind of pre-filled entry point.
  return vscode.commands.registerCommand(COMMANDS.compareBranchFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    const currentBranch = await git.getCurrentBranch(filePath);
    if (!currentBranch) {
      return;
    }
    await vscode.commands.executeCommand(COMMANDS.compareBranches, currentBranch, node.branch.name);
  });
}

/** Runs in the shared Git Sync terminal, not via simple-git — a merge can conflict, and a terminal is where the user resolves one. */
export function handleMergeBranchCommand(git: GitService): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.mergeBranchFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Merge '${node.branch.name}' into the current branch? A conflict, if there is one, opens in the terminal for you to resolve.`,
      { modal: true },
      'Merge',
    );
    if (confirmed !== 'Merge') {
      return;
    }
    const repoRoot = await git.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    runInGitSyncTerminal(repoRoot, `git merge ${node.branch.name}`);
  });
}

/** Runs in the shared Git Sync terminal, not via simple-git — a rebase can conflict, and a terminal is where the user resolves one. */
export function handleRebaseOntoBranchCommand(git: GitService): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.rebaseOntoBranchFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Rebase the current branch onto '${node.branch.name}'? A conflict, if there is one, opens in the terminal for you to resolve.`,
      { modal: true },
      'Rebase',
    );
    if (confirmed !== 'Rebase') {
      return;
    }
    const repoRoot = await git.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    runInGitSyncTerminal(repoRoot, `git rebase ${node.branch.name}`);
  });
}

export function handleOpenRemoteCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.openRemote, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'remote') {
      return;
    }
    const remote = parseRemoteUrl(node.remote.url);
    if (!remote) {
      void vscode.window.showInformationMessage(`GitLore: couldn't parse remote URL '${node.remote.url}'.`);
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(buildRepoUrl(remote)));
  });
}

export function handleApplyStashCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.applyStash, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'stash') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.applyStash(filePath, node.stash.index);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't apply stash — ${errorMessage(err)}`);
    }
  });
}

export function handleDropStashCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.dropStash, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'stash') {
      return;
    }
    // Destructive and irreversible — confirm before GitLore deletes a stash entry on the user's behalf.
    const confirmed = await vscode.window.showWarningMessage(
      `Delete stash '${node.stash.message}'? This can't be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.dropStash(filePath, node.stash.index);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't drop stash — ${errorMessage(err)}`);
    }
  });
}

export function handleRenameBranchCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.renameBranchFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch' || node.branch.isRemote) {
      return;
    }
    const newName = await vscode.window.showInputBox({
      prompt: `New name for '${node.branch.name}'`,
      value: node.branch.name,
    });
    if (!newName || newName === node.branch.name) {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.renameBranch(filePath, node.branch.name, newName);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't rename '${node.branch.name}' — ${errorMessage(err)}`);
    }
  });
}

export function handleDeleteBranchCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.deleteBranchFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch' || node.branch.isRemote || node.branch.isCurrent) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete local branch '${node.branch.name}'? This can't be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.deleteBranch(filePath, node.branch.name, false);
      await explorer.refreshCurrent();
    } catch (err) {
      // `-d` refuses an unmerged branch — the user already confirmed a destructive, unrecoverable
      // delete above, so retrying with `-D` here doesn't ask them to confirm the same thing twice.
      if (err instanceof GitCommandError && /not fully merged/i.test(err.stderr)) {
        try {
          await git.deleteBranch(filePath, node.branch.name, true);
          await explorer.refreshCurrent();
          return;
        } catch (forceErr) {
          void vscode.window.showErrorMessage(`GitLore: couldn't delete '${node.branch.name}' — ${errorMessage(forceErr)}`);
          return;
        }
      }
      void vscode.window.showErrorMessage(`GitLore: couldn't delete '${node.branch.name}' — ${errorMessage(err)}`);
    }
  });
}

export function handleDeleteTagCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.deleteTagFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'tag') {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete tag '${node.tag.name}'? This can't be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.deleteTag(filePath, node.tag.name);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't delete tag '${node.tag.name}' — ${errorMessage(err)}`);
    }
  });
}

export function handleAddWorktreeCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.addWorktreeFromExplorer, async (node?: ExplorerNode) => {
    if (node?.kind !== 'section' || node.id !== 'worktrees') {
      return;
    }
    const worktreePath = await vscode.window.showInputBox({
      prompt: 'Path for the new worktree',
      placeHolder: '/path/to/new-worktree',
    });
    if (!worktreePath) {
      return;
    }
    const branch = await vscode.window.showInputBox({
      prompt: 'Branch to check out in the new worktree',
      placeHolder: 'feature/my-branch',
    });
    if (!branch) {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.addWorktree(filePath, worktreePath, branch);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't add worktree at '${worktreePath}' — ${errorMessage(err)}`);
    }
  });
}

export function handleRemoveWorktreeCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.removeWorktreeFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'worktree' || node.worktree.isMain) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Remove worktree at '${node.worktree.path}'? This can't be undone.`,
      { modal: true },
      'Remove',
    );
    if (confirmed !== 'Remove') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.removeWorktree(filePath, node.worktree.path);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't remove worktree at '${node.worktree.path}' — ${errorMessage(err)}`);
    }
  });
}

export function handleCreateStashCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.createStashFromExplorer, async (node?: ExplorerNode) => {
    if (node?.kind !== 'section' || node.id !== 'stashes') {
      return;
    }
    const message = await vscode.window.showInputBox({
      prompt: 'Stash message (optional)',
      placeHolder: 'WIP: describe your changes',
    });
    // An empty string and a dismissed input box both come back falsy from showInputBox — either
    // way, `message || undefined` below falls back to a plain `git stash push` with no -m.
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.createStash(filePath, message || undefined);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't create stash — ${errorMessage(err)}`);
    }
  });
}
