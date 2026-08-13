import * as vscode from 'vscode';
import type { GitService } from '../core/git/GitService';

const WARNED_KEY = 'gitLore.gitMissingWarningShown';

/**
 * One-time warning when the `git` binary itself can't be found, per the §13 error taxonomy.
 * Persisted in globalState (not just this session) so a user who dismisses it isn't nagged
 * again on every reload while they go install git.
 */
export async function warnIfGitUnavailable(ctx: vscode.ExtensionContext, git: GitService): Promise<void> {
  if (ctx.globalState.get<boolean>(WARNED_KEY)) {
    return;
  }
  if (await git.isGitAvailable()) {
    return;
  }
  await ctx.globalState.update(WARNED_KEY, true);
  const choice = await vscode.window.showWarningMessage(
    "GitLore can't find git on your PATH — blame, history, and the commit graph need it to work.",
    'Install Git',
  );
  if (choice === 'Install Git') {
    void vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
  }
}
