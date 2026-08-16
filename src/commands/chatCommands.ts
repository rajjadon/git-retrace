import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { ChatViewProvider } from '../views/Chat/ChatViewProvider';
import type { CommitDetailsViewProvider } from '../views/CommitDetails/CommitDetailsViewProvider';
import type { PullRequestDetailsViewProvider } from '../views/PullRequestDetails/PullRequestDetailsViewProvider';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import { basename } from 'node:path';

export function handleOpenChatCommand(provider: ChatViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.openChat, async () => {
    await provider.show();
  });
}

export function handleAskAboutFileCommand(provider: ChatViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutFile, async () => {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      void vscode.window.showInformationMessage('GitLore: open a file in a git repo to ask about it.');
      return;
    }
    await provider.show(basename(filePath));
  });
}

export function handleAskAboutCommitCommand(
  commitDetailsProvider: CommitDetailsViewProvider,
  chatProvider: ChatViewProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutCommit, async () => {
    const subject = commitDetailsProvider.getCurrentSubjectForChat();
    if (!subject) {
      void vscode.window.showInformationMessage('GitLore: open a commit in Commit Details first.');
      return;
    }
    await chatProvider.show(subject);
  });
}

export function handleAskAboutLineCommand(chatProvider: ChatViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutLine, async (filePath?: string, lineContent?: string) => {
    if (typeof filePath !== 'string' || typeof lineContent !== 'string') {
      void vscode.window.showInformationMessage('GitLore: pick a line with committed history to ask about.');
      return;
    }
    await chatProvider.show(`${basename(filePath)}: ${lineContent.trim().slice(0, 60)}`);
  });
}

export function handleAskAboutPullRequestCommand(
  pullRequestDetailsProvider: PullRequestDetailsViewProvider,
  chatProvider: ChatViewProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutPullRequest, async () => {
    const subject = pullRequestDetailsProvider.getCurrentSubjectForChat();
    if (!subject) {
      void vscode.window.showInformationMessage('GitLore: open a PR in Pull Request Details first.');
      return;
    }
    await chatProvider.show(subject);
  });
}
