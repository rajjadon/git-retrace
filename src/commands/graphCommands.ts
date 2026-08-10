import * as vscode from 'vscode';
import { COMMANDS, CONFIG } from '../constants';
import type { GitService } from '../core/git/GitService';
import { CommitGraphPanel } from '../views/CommitGraph/CommitGraphPanel';

const DEFAULT_MAX_GRAPH_ITEMS = 200;

export function handleOpenGraphCommand(git: GitService, extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.openGraph, async () => {
    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
      void vscode.window.showInformationMessage('GitSense: open a file in a git repo to see its commit graph.');
      return;
    }
    const maxCount = vscode.workspace
      .getConfiguration(CONFIG.section)
      .get<number>(CONFIG.maxGraphItems, DEFAULT_MAX_GRAPH_ITEMS);
    await CommitGraphPanel.show(extensionUri, git, filePath, maxCount);
  });
}
