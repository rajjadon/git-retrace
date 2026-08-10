import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { Commit } from '../core/git/types';
import { formatAge } from '../utils/date';
import { CONFIG, CONTEXT_KEYS, VIEWS, COMMANDS } from '../constants';

const DEFAULT_MAX_HISTORY_ITEMS = 200;

export class FileHistoryProvider implements vscode.TreeDataProvider<Commit>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly disposables: vscode.Disposable[] = [this.onDidChangeTreeDataEmitter];
  private commits: Commit[] = [];
  private currentFilePath: string | undefined;
  private tracking = false;
  private treeView: vscode.TreeView<Commit> | undefined;

  constructor(private readonly git: GitService) {}

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** Called by the "Show File History" command. Lazily registers the view and starts following the active editor. */
  async show(): Promise<void> {
    if (!this.treeView) {
      this.treeView = vscode.window.createTreeView(VIEWS.fileHistory, { treeDataProvider: this });
      this.disposables.push(this.treeView);
    }
    if (!this.tracking) {
      this.tracking = true;
      this.disposables.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
          void this.loadForEditor(editor);
        }),
      );
    }
    // Gates the view's `when` clause — the sidebar section stays hidden until first asked for.
    await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.fileHistoryHasContent, true);
    await this.loadForEditor(vscode.window.activeTextEditor);
    await vscode.commands.executeCommand(`${VIEWS.fileHistory}.focus`);
  }

  getTreeItem(commit: Commit): vscode.TreeItem {
    const item = new vscode.TreeItem(commit.message, vscode.TreeItemCollapsibleState.None);
    item.description = `${commit.author}, ${formatAge(new Date(commit.date))}`;
    item.tooltip = new vscode.MarkdownString(
      `**${commit.author}**\n\n${commit.message}\n\n${commit.date} · \`${commit.shortSha}\``,
    );
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.contextValue = 'gitsense.commit';
    item.command = {
      command: COMMANDS.showCommit,
      title: 'Show Commit Details',
      arguments: [this.currentFilePath, commit.sha],
    };
    return item;
  }

  getChildren(): Commit[] {
    return this.commits;
  }

  private async loadForEditor(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor || editor.document.uri.scheme !== 'file') {
      this.currentFilePath = undefined;
      this.setCommits([], 'Open a file to see its history.');
      return;
    }

    this.currentFilePath = editor.document.uri.fsPath;
    const maxCount = this.getConfig<number>(CONFIG.maxHistoryItems, DEFAULT_MAX_HISTORY_ITEMS);
    try {
      const commits = await this.git.getFileHistory(editor.document.uri.fsPath, maxCount);
      this.setCommits(commits, commits.length === 0 ? 'This file has no history.' : undefined);
    } catch (err) {
      this.setCommits([], undefined);
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`GitSense: failed to load file history — ${message}`);
    }
  }

  private setCommits(commits: Commit[], message: string | undefined): void {
    this.commits = commits;
    if (this.treeView) {
      this.treeView.message = message;
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
  }
}
