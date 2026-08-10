import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import type { BranchInfo } from '../core/git/types';
import type { BranchComparisonViewProvider } from '../views/BranchComparison/BranchComparisonViewProvider';

function toQuickPickItem(branch: BranchInfo): vscode.QuickPickItem {
  return {
    label: branch.name,
    description: branch.isRemote ? 'remote' : branch.isCurrent ? 'current branch' : undefined,
  };
}

export function handleCompareBranchesCommand(git: GitService, provider: BranchComparisonViewProvider): vscode.Disposable {
  // Accepts optional (base, compare) so it's directly scriptable — e.g. from a future
  // status-bar/tree item, or a test — bypassing the interactive QuickPick flow below.
  return vscode.commands.registerCommand(COMMANDS.compareBranches, async (base?: string, compare?: string) => {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
      void vscode.window.showInformationMessage('GitSense: open a file in a git repo to compare branches.');
      return;
    }

    if (base && compare) {
      await provider.show(filePath, base, compare);
      return;
    }

    const branches = await git.getBranches(filePath);
    if (branches.length < 2) {
      void vscode.window.showInformationMessage('GitSense: need at least two branches to compare.');
      return;
    }
    const items = branches.map(toQuickPickItem);

    const basePick = await vscode.window.showQuickPick(items, { placeHolder: 'Select the base branch' });
    if (!basePick) {
      return;
    }

    const comparePick = await vscode.window.showQuickPick(items, {
      placeHolder: `Select the branch to compare against ${basePick.label}`,
    });
    if (!comparePick) {
      return;
    }

    await provider.show(filePath, basePick.label, comparePick.label);
  });
}
