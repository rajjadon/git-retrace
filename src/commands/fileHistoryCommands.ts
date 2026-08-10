import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { FileHistoryProvider } from '../providers/FileHistoryProvider';
import type { Commit } from '../core/git/types';

export function handleShowFileHistoryCommand(provider: FileHistoryProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showFileHistory, () => {
    void provider.show();
  });
}

export function handleCopyShaCommand(): vscode.Disposable {
  // A tree-item click passes the sha string directly (see FileHistoryProvider.getTreeItem's
  // `command.arguments`), but a `view/item/context` menu entry invokes with the tree element
  // itself (a Commit object) — this command has to accept either shape.
  return vscode.commands.registerCommand(COMMANDS.copySha, async (arg: string | Commit) => {
    const sha = typeof arg === 'string' ? arg : arg.sha;
    await vscode.env.clipboard.writeText(sha);
    void vscode.window.showInformationMessage(`GitSense: copied ${sha.slice(0, 7)}`);
  });
}
