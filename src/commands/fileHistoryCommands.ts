import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { FileHistoryProvider } from '../providers/FileHistoryProvider';
import type { Commit } from '../core/git/types';

export function handleShowFileHistoryCommand(provider: FileHistoryProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showFileHistory, () => {
    void provider.show();
  });
}

/** Pulls a sha out of either invocation shape, or null when there's nothing usable. */
function resolveSha(arg: unknown): string | null {
  if (typeof arg === 'string' && arg.length > 0) {
    return arg;
  }
  if (typeof arg === 'object' && arg !== null) {
    const { sha } = arg as { sha?: unknown };
    if (typeof sha === 'string' && sha.length > 0) {
      return sha;
    }
  }
  return null;
}

export function handleCopyShaCommand(): vscode.Disposable {
  // A tree-item click passes the sha string directly (see FileHistoryProvider.getTreeItem's
  // `command.arguments`), but a `view/item/context` menu entry invokes with the tree element
  // itself (a Commit object) — this command has to accept either shape.
  //
  // It is also hidden from the command palette, because there is no sha to copy there. Guarding
  // anyway: a registered command can be invoked by a keybinding or another extension, and reading
  // `.sha` off undefined threw an unhandled rejection rather than saying anything useful.
  return vscode.commands.registerCommand(COMMANDS.copySha, async (arg?: string | Commit) => {
    const sha = resolveSha(arg);
    if (!sha) {
      void vscode.window.showInformationMessage('GitSense: pick a commit first to copy its SHA.');
      return;
    }
    await vscode.env.clipboard.writeText(sha);
    void vscode.window.showInformationMessage(`GitSense: copied ${sha.slice(0, 7)}`);
  });
}
