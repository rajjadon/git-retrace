import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import { GitCommandError } from '../core/git/errors';
import type { ReflogEntry } from '../core/git/types';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import type { RepoExplorerProvider } from '../providers/RepoExplorerProvider';

function errorMessage(err: unknown): string {
  return err instanceof GitCommandError ? err.stderr : err instanceof Error ? err.message : String(err);
}

/** Lists recent reflog entries and creates a branch at the chosen one — recovers a commit or branch a hard reset, force push, or accidental delete left dangling but not yet garbage-collected. */
export function handleRecoverFromReflogCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.recoverFromReflog, async () => {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    const entries = await git.getReflog(filePath, 100);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('GitLore: no reflog entries found.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((entry: ReflogEntry) => ({
        label: entry.selector,
        description: entry.message,
        detail: entry.sha.slice(0, 7),
        entry,
      })),
      { placeHolder: 'Recover a commit or branch from the reflog' },
    );
    if (!picked) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: `New branch name at ${picked.entry.selector}`,
      placeHolder: 'recovered-branch',
    });
    if (!name) {
      return;
    }
    try {
      await git.createBranch(filePath, name, picked.entry.sha);
      await explorer.refreshCurrent();
      void vscode.window.showInformationMessage(`GitLore: created branch '${name}' at ${picked.entry.selector}.`);
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't recover from reflog — ${errorMessage(err)}`);
    }
  });
}
