import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { CommitDetailsViewProvider } from '../views/CommitDetails/CommitDetailsViewProvider';

export function handleShowCommitCommand(provider: CommitDetailsViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showCommit, async (filePath?: string, sha?: string) => {
    if (!filePath || !sha) {
      void vscode.window.showInformationMessage('Git Retrace: pick a commit from File History to see its details.');
      return;
    }
    await provider.show(filePath, sha);
  });
}
