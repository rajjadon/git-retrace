import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { PullRequestDetailsViewProvider } from '../views/PullRequestDetails/PullRequestDetailsViewProvider';
import type { LaunchpadViewProvider } from '../views/Launchpad/LaunchpadViewProvider';

export function handleShowPullRequestCommand(
  detailsProvider: PullRequestDetailsViewProvider,
  launchpadProvider: LaunchpadViewProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showPullRequest, async (key?: string) => {
    if (!key) {
      void vscode.window.showInformationMessage('GitLore: open a PR from Launchpad to see its details.');
      return;
    }
    const resolved = launchpadProvider.resolvePullRequestForDetails(key);
    if (!resolved) {
      void vscode.window.showWarningMessage("GitLore: this PR isn't on the board anymore — try refreshing Launchpad.");
      return;
    }
    await detailsProvider.show(resolved.pr, resolved.client);
  });
}
