import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import {
  readMaxGraphItems,
  resolveRepoContextPath,
  type CommitGraphViewProvider,
} from '../views/CommitGraph/CommitGraphViewProvider';

export function handleOpenGraphCommand(provider: CommitGraphViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.openGraph, async () => {
    // The graph is repo-wide, so any path inside the repo works — an open editor is only a hint
    // about *which* repo in a multi-root workspace. Without one, fall back to the workspace root
    // rather than refusing to open.
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      void vscode.window.showInformationMessage('GitLore: open a folder or file in a git repo to see its commit graph.');
      return;
    }
    await provider.show(filePath, readMaxGraphItems());
  });
}
