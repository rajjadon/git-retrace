import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import { shellQuotePosix } from '../utils/shellQuote';

export function handleRebaseInteractivelyCommand(git: GitService): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.rebaseInteractively, async () => {
    const filePath = resolveRepoContextPath();
    const repoRoot = filePath ? await git.getRepoRoot(filePath) : null;
    if (!filePath || !repoRoot) {
      void vscode.window.showInformationMessage('GitLore: open a folder or file in a git repo to rebase.');
      return;
    }

    const branches = await git.getBranches(filePath);
    const picked = await vscode.window.showQuickPick(
      branches.map((b) => ({ label: b.name, description: b.isRemote ? 'remote' : b.isCurrent ? 'current' : undefined })),
      { title: 'GitLore: Rebase Branch Interactively', placeHolder: 'Rebase the current branch onto…' },
    );
    if (!picked) {
      return;
    }

    // A one-off `-c` override, scoped to this single command — never written to the user's own
    // git config. GitLore doesn't run `git rebase` itself beyond this: everything after this point
    // is the RebaseEditorProvider reading, writing, and closing the todo file git opens in response.
    const terminal = vscode.window.createTerminal({ name: 'GitLore: Rebase', cwd: repoRoot });
    terminal.show();
    terminal.sendText(`git -c sequence.editor="code --wait" rebase -i ${shellQuotePosix(picked.label)}`);
  });
}
