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

      const state = await service.getState(filePath, sha, lineContent);
      if (state === undefined) {
        // Disabled (already showed its own "AI features are disabled" prompt) or aborted
        // (silent by design) — nothing more to surface.
        return;
      }

      const editor = vscode.window.activeTextEditor;
      const stillOnSameLine =
        editor !== undefined &&
        editor.document.uri.fsPath === filePath &&
        editor.selection.active.line < editor.document.lineCount &&
        editor.document.lineAt(editor.selection.active.line).text.slice(0, 500) === lineContent;

      if (stillOnSameLine) {
        // Closest achievable approximation of "the hover updates" — a vscode.Hover cannot
        // actually be updated in place (no live-streaming API), so this forces a fresh one at
        // the current cursor position, which now reads the state explain() just wrote.
        await vscode.commands.executeCommand('editor.action.showHover');
      } else {
        // Cursor moved (different line, different file, or no active editor) — auto-reopening
        // would show a hover for the wrong position or surprise the user mid-something-else.
        void vscode.window.showInformationMessage('GitLore: line explanation finished — hover the line again to view it.');
      }
    },
  );
}
