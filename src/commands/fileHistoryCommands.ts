import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { FileHistoryProvider } from '../providers/FileHistoryProvider';

export function handleShowFileHistoryCommand(provider: FileHistoryProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showFileHistory, () => {
    void provider.show();
  });
}

export function handleCopyShaCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.copySha, async (sha: string) => {
    await vscode.env.clipboard.writeText(sha);
    void vscode.window.showInformationMessage(`GitSense: copied ${sha.slice(0, 7)}`);
  });
}
