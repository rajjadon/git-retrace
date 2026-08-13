import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { Commit } from '../core/git/types';
import { formatAge, formatAbsolute } from '../utils/date';
import { buildGravatarUrl } from '../utils/gravatar';
import { escapeMarkdown } from '../utils/format';
import { CONFIG, CONTEXT_KEYS, VIEWS, COMMANDS } from '../constants';

const DEFAULT_MAX_HISTORY_ITEMS = 200;

/** Sentinel tree node for the "Load more" row — distinguishes it from a real `Commit` at render time. */
export interface LoadMoreNode {
  kind: 'loadMore';
}

const LOAD_MORE_NODE: LoadMoreNode = { kind: 'loadMore' };

export type FileHistoryNode = Commit | LoadMoreNode;

export function isLoadMoreNode(node: FileHistoryNode): node is LoadMoreNode {
  return 'kind' in node && node.kind === 'loadMore';
}

export class FileHistoryProvider implements vscode.TreeDataProvider<FileHistoryNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly disposables: vscode.Disposable[] = [this.onDidChangeTreeDataEmitter];
  private commits: Commit[] = [];
  private currentFilePath: string | undefined;
  private currentMaxCount = DEFAULT_MAX_HISTORY_ITEMS;
  // True when the last load returned exactly the requested cap — a signal (not a guarantee) that
  // there may be more commits past it, since `git log -n <cap>` can't distinguish "exactly cap
  // commits total" from "more than cap". Clicking "Load more" re-asks with a higher cap either way.
  private hasMore = false;
  private tracking = false;
  private treeView: vscode.TreeView<FileHistoryNode> | undefined;
  // Guards against a superseded load (rapid tab-switching) overwriting the tree with a stale
  // file's history once an earlier lookup resolves after a later one.
  private loadGeneration = 0;

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

  getTreeItem(node: FileHistoryNode): vscode.TreeItem {
    if (isLoadMoreNode(node)) {
      const item = new vscode.TreeItem('Load more commits…', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('ellipsis');
      item.contextValue = 'gitLore.loadMore';
      item.command = { command: COMMANDS.loadMoreFileHistory, title: 'Load More File History' };
      return item;
    }

    const commit = node;
    const item = new vscode.TreeItem(commit.message, vscode.TreeItemCollapsibleState.None);
    item.description = `${commit.author}, ${formatAge(new Date(commit.date))}`;
    const date = new Date(commit.date);
    const avatarUrl = buildGravatarUrl(commit.authorEmail);
    item.tooltip = new vscode.MarkdownString(
      `![](${avatarUrl}) **${escapeMarkdown(commit.author)}**\n\n${escapeMarkdown(commit.message)}\n\n${formatAge(date)} · ${formatAbsolute(date, 'yyyy-MM-dd HH:mm')} · \`${commit.shortSha}\``,
    );
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.contextValue = 'gitLore.commit';
    item.command = {
      command: COMMANDS.showCommit,
      title: 'Show Commit Details',
      arguments: [this.currentFilePath, commit.sha],
    };
    return item;
  }

  getChildren(): FileHistoryNode[] {
    return this.hasMore ? [...this.commits, LOAD_MORE_NODE] : this.commits;
  }

  /** Called by the "Load more commits" tree item — re-asks with a higher cap, same file. */
  async loadMore(): Promise<void> {
    if (!this.currentFilePath || !this.hasMore) {
      return;
    }
    const step = this.getConfig<number>(CONFIG.maxHistoryItems, DEFAULT_MAX_HISTORY_ITEMS);
    await this.loadForPath(this.currentFilePath, this.currentMaxCount + step);
  }

  private async loadForEditor(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor || editor.document.uri.scheme !== 'file') {
      this.loadGeneration++;
      this.currentFilePath = undefined;
      this.setCommits([], 'Open a file to see its history.');
      return;
    }
    const maxCount = this.getConfig<number>(CONFIG.maxHistoryItems, DEFAULT_MAX_HISTORY_ITEMS);
    await this.loadForPath(editor.document.uri.fsPath, maxCount);
  }

  private async loadForPath(filePath: string, maxCount: number): Promise<void> {
    const generation = ++this.loadGeneration;
    this.currentFilePath = filePath;
    this.currentMaxCount = maxCount;
    try {
      const commits = await this.git.getFileHistory(filePath, maxCount);
      if (generation !== this.loadGeneration) {
        return;
      }
      this.setCommits(commits, commits.length === 0 ? 'This file has no history.' : undefined);
    } catch (err) {
      if (generation !== this.loadGeneration) {
        return;
      }
      this.setCommits([], undefined);
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`GitLore: failed to load file history — ${message}`);
    }
  }

  private setCommits(commits: Commit[], message: string | undefined): void {
    this.commits = commits;
    this.hasMore = commits.length > 0 && commits.length === this.currentMaxCount;
    if (this.treeView) {
      this.treeView.message = message;
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
  }
}
