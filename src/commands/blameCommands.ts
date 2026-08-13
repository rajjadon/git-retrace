import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { BlameDecorationProvider } from '../providers/BlameDecorationProvider';
import type { FullFileBlameDecorationProvider } from '../providers/FullFileBlameDecorationProvider';
import type { GitService } from '../core/git/GitService';
import { buildCacheKey } from '../utils/path';
import type { LruCache } from '../core/cache/LruCache';

export function handleToggleBlameCommand(provider: BlameDecorationProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.toggleBlame, () => {
    provider.toggle();
  });
}

export function handleToggleFullFileBlameCommand(provider: FullFileBlameDecorationProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.toggleFullFileBlame, () => {
    provider.toggle();
  });
}

/**
 * Moves the blame hover's line-history stepper one step and re-opens the hover to show it.
 * Fetches the line's full `-L` history on every step (not just the first) — the total count can
 * shift between clicks if the file is edited, and this is a rare, deliberate click rather than
 * something worth caching against that risk.
 */
export function handleStepLineHistoryCommand(git: GitService, navStore: LruCache<string, number>): vscode.Disposable {
  return vscode.commands.registerCommand(
    COMMANDS.stepLineHistory,
    async (filePath?: string, line?: number, direction?: 'prev' | 'next') => {
      if (typeof filePath !== 'string' || typeof line !== 'number' || (direction !== 'prev' && direction !== 'next')) {
        return;
      }
      const history = await git.getLineHistory(filePath, line);
      if (history.length === 0) {
        return;
      }

      const repoRoot = await git.getRepoRoot(filePath);
      const key = buildCacheKey(repoRoot ?? filePath, filePath, String(line));
      const current = navStore.get(key) ?? 0;
      const proposed = direction === 'prev' ? current + 1 : current - 1;
      navStore.set(key, Math.max(0, Math.min(history.length - 1, proposed)));

      const editor = vscode.window.activeTextEditor;
      const stillOnSameLine =
        editor !== undefined && editor.document.uri.fsPath === filePath && editor.selection.active.line === line;
      if (stillOnSameLine) {
        // Closest achievable approximation of "the hover updates in place" — see the identical
        // note on gitLore.explainLine, which established this pattern first.
        await vscode.commands.executeCommand('editor.action.showHover');
      }
    },
  );
}
