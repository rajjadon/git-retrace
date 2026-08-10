import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import { CommitDetailsPanel } from '../views/CommitDetails/CommitDetailsPanel';

export function handleShowCommitCommand(git: GitService, extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showCommit, async (filePath?: string, sha?: string) => {
    if (!filePath || !sha) {
      void vscode.window.showInformationMessage('GitSense: pick a commit from File History to see its details.');
      return;
    }
    await CommitDetailsPanel.show(extensionUri, git, filePath, sha);
  });
}
