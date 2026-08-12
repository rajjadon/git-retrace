import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { CommitDetailsViewProvider } from '../views/CommitDetails/CommitDetailsViewProvider';
import type { LineExplanationService } from '../ai/LineExplanationService';

export function handleExplainCommitCommand(provider: CommitDetailsViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.explainCommit, async () => {
    if (!provider.hasLoadedCommit()) {
      void vscode.window.showInformationMessage('GitLore: open a commit in Commit Details first.');
      return;
    }
    await provider.explainCommit();
  });
}

export function handleExplainLineCommand(service: LineExplanationService): vscode.Disposable {
  return vscode.commands.registerCommand(
    COMMANDS.explainLine,
    async (filePath?: string, sha?: string, lineContent?: string) => {
      if (typeof filePath !== 'string' || typeof sha !== 'string' || typeof lineContent !== 'string') {
        void vscode.window.showInformationMessage('GitLore: pick a line with committed history to explain.');
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'GitLore: explaining line…' },
        async () => {
          const controller = new AbortController();
          await service.explain(filePath, sha, lineContent, controller.signal);
        },
      );
    },
  );
}
