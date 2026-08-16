import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import { GitCommandError } from '../core/git/errors';
import { parseRemoteUrl } from '../core/git/parsers';
import { buildRepoUrl } from '../utils/remoteLinks';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import { runInGitSyncTerminal } from '../views/gitSyncTerminal';
import type { RepoExplorerProvider } from '../providers/RepoExplorerProvider';
import type { ExplorerLeafNode } from '../core/explorer/buildExplorerTree';

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
