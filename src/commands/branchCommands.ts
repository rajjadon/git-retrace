import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import { pickDefaultRefs } from '../utils/branchDefaults';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import type { BranchComparisonViewProvider } from '../views/BranchComparison/BranchComparisonViewProvider';

export function handleCompareBranchesCommand(git: GitService, provider: BranchComparisonViewProvider): vscode.Disposable {
  // Accepts optional (base, compare) so it's directly scriptable — e.g. from a future
  // status-bar/tree item, or a test.
  return vscode.commands.registerCommand(COMMANDS.compareBranches, async (base?: string, compare?: string) => {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      void vscode.window.showInformationMessage('GitSense: open a folder or file in a git repo to compare branches.');
      return;
    }

    if (base && compare) {
      await provider.show(filePath, base, compare);
      return;
    }

    // No QuickPick gauntlet: the view has both ref pickers in its own toolbar now, so opening on a
    // sensible default and letting the user retarget in place beats two modal prompts up front.
    const [branches, currentBranch] = await Promise.all([git.getBranches(filePath), git.getCurrentBranch(filePath)]);
    const refs = pickDefaultRefs(branches, currentBranch);
    if (!refs) {
      void vscode.window.showInformationMessage('GitSense: need at least two branches to compare.');
      return;
    }
    await provider.show(filePath, refs.base, refs.compare);
  });
}
