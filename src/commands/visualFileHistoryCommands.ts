import * as vscode from 'vscode';
import { COMMANDS, CONFIG } from '../constants';
import type { VisualFileHistoryViewProvider } from '../views/VisualFileHistory/VisualFileHistoryViewProvider';

const DEFAULT_MAX_HISTORY_ITEMS = 200;

export function handleShowVisualFileHistoryCommand(provider: VisualFileHistoryViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showVisualFileHistory, async () => {
    // Unlike the commit graph (repo-wide), this view is scoped to one file — there's no
    // sensible workspace-root fallback when no editor is open.
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
      void vscode.window.showInformationMessage('GitLore: open a tracked file to see its Visual File History.');
      return;
    }
    const maxCount = vscode.workspace
      .getConfiguration(CONFIG.section)
      .get<number>(CONFIG.maxHistoryItems, DEFAULT_MAX_HISTORY_ITEMS);
    await provider.show(filePath, maxCount);
  });
}
