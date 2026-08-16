import * as vscode from 'vscode';
import { join } from 'node:path';
import { COMMANDS } from '../constants';
import type { CoChangedFile } from '../core/git/types';

/** Exported standalone so the picker's contents are directly testable without driving the real interactive QuickPick. */
export function buildCoChangeQuickPickItems(coChanged: CoChangedFile[]): (vscode.QuickPickItem & { path: string })[] {
  return coChanged.map((f) => ({
    label: f.path.split('/').pop() ?? f.path,
    description: f.path,
    detail: `Changed together in ${f.coChanges}/${f.totalCommits} commits · ${Math.round(f.coupling * 100)}%`,
    path: f.path,
  }));
}

export function handleShowCoChangedFilesCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showCoChangedFiles, async (repoRoot?: string, coChanged?: CoChangedFile[]) => {
    if (!repoRoot || !coChanged || coChanged.length === 0) {
      return;
    }
    const picked = await vscode.window.showQuickPick(buildCoChangeQuickPickItems(coChanged), {
      placeHolder: 'Often changed together with this file',
    });
    if (!picked) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(repoRoot, picked.path)));
    await vscode.window.showTextDocument(doc);
  });
}
