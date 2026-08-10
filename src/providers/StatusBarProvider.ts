import * as vscode from 'vscode';
import type { ActiveLineBlame, BlameDecorationProvider } from './BlameDecorationProvider';
import { formatBlameEntry } from '../utils/blameFormat';
import { CONFIG, COMMANDS } from '../constants';

/** Mirrors the inline decoration's content in the status bar, click → commit details. Reuses BlameDecorationProvider's active-line tracking instead of re-subscribing to the same editor/selection/config events. */
export class StatusBarProvider implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private lastText: string | undefined;

  constructor(decorationProvider: BlameDecorationProvider) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.disposables.push(
      this.item,
      decorationProvider.onDidUpdate((update) => {
        this.render(update);
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** Test-only introspection seam — VS Code's public API doesn't expose a status bar item's current text/visibility. */
  getTextForTest(): string | undefined {
    return this.lastText;
  }

  private render(update: ActiveLineBlame | undefined): void {
    if (!update?.entry) {
      this.item.hide();
      this.lastText = undefined;
      return;
    }

    const { editor, entry } = update;
    const format = this.getConfig<string>(CONFIG.blameFormat, '{author}, {age}');
    this.item.text = `$(git-commit) ${formatBlameEntry(entry, format)}`;
    this.item.tooltip = entry.summary;
    this.item.command = entry.isUncommitted
      ? undefined
      : {
          command: COMMANDS.showCommit,
          title: 'Show Commit Details',
          arguments: [editor.document.uri.fsPath, entry.sha],
        };
    this.item.show();
    this.lastText = this.item.text;
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
  }
}
