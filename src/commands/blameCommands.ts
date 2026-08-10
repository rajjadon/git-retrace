import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { BlameDecorationProvider } from '../providers/BlameDecorationProvider';

export function handleToggleBlameCommand(provider: BlameDecorationProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.toggleBlame, () => {
    provider.toggle();
  });
}
