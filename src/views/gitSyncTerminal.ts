import * as vscode from 'vscode';
import { SYNC_TERMINAL_NAME } from '../constants';

/** Sends `command` to the shared "GitLore: Git Sync" terminal, reusing it if already open — the terminal is where the user handles interactive auth or a conflict a headless git call can't resolve itself. */
export function runInGitSyncTerminal(repoRoot: string, command: string): void {
  const terminal =
    vscode.window.terminals.find((t) => t.name === SYNC_TERMINAL_NAME) ??
    vscode.window.createTerminal({ name: SYNC_TERMINAL_NAME, cwd: repoRoot });
  terminal.show();
  terminal.sendText(command);
}
