import * as vscode from 'vscode';
import type { GitService } from '../core/git/GitService';
import type { BranchInfo } from '../core/git/types';
import {
  buildExplorerSections,
  type ExplorerLeafNode,
  type ExplorerNode,
  type ExplorerSectionNode,
} from '../core/explorer/buildExplorerTree';

/**
 * Single tree for the Sidebar Explorer's six sections — Branches, Remotes, Tags, Stashes,
 * Worktrees, Contributors — matching the one-tree structure in the reference mockup rather than
 * six separate views. Best-effort by design: a native `TreeItem` only supports a label, a dimmed
 * description, and one `ThemeIcon` — no colored pills, no per-substring color, no custom avatars.
 */
export class RepoExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.onDidChangeTreeDataEmitter];
  private sections: ExplorerSectionNode[] = [];
  private currentFilePath: string | undefined;

  constructor(private readonly git: GitService) {}

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** Tracks the active editor, purely so a multi-root workspace re-scopes to whichever repo the user is actually looking at. */
  watchActiveEditor(): vscode.Disposable {
    return vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        void this.refresh(editor.document.uri.fsPath);
      }
    });
  }

  async refresh(filePath: string): Promise<void> {
    this.currentFilePath = filePath;
    const [branches, remotes, tags, stashes, worktrees, contributors] = await Promise.all([
      this.git.getBranches(filePath),
      this.git.getRemotes(filePath),
      this.git.getTags(filePath),
      this.git.getStashes(filePath),
      this.git.getWorktrees(filePath),
      this.git.getContributors(filePath),
    ]);
    this.sections = buildExplorerSections({ branches, remotes, tags, stashes, worktrees, contributors });
    this.onDidChangeTreeDataEmitter.fire();
  }

  /** Re-runs the last load — used after a mutating action (checkout, stash apply/drop) so the tree reflects what just changed. */
  async refreshCurrent(): Promise<void> {
    if (this.currentFilePath) {
      await this.refresh(this.currentFilePath);
    }
  }

  getChildren(element?: ExplorerNode): ExplorerNode[] {
    if (!element) {
      return this.sections;
    }
    return element.kind === 'section' ? element.children : [];
  }

  getTreeItem(element: ExplorerNode): vscode.TreeItem {
    if (element.kind === 'section') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.description = String(element.children.length);
      return item;
    }
    return this.leafTreeItem(element);
  }

  private leafTreeItem(node: ExplorerLeafNode): vscode.TreeItem {
    switch (node.kind) {
      case 'branch':
        return this.branchTreeItem(node.branch);
      case 'remote': {
        const item = new vscode.TreeItem(node.remote.name, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('cloud');
        item.description = node.remote.url;
        item.contextValue = 'gitLore.remote';
        return item;
      }
      case 'tag': {
        const item = new vscode.TreeItem(node.tag.name, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('tag');
        item.contextValue = 'gitLore.tag';
        return item;
      }
      case 'stash': {
        const item = new vscode.TreeItem(node.stash.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('archive');
        item.contextValue = 'gitLore.stash';
        return item;
      }
      case 'worktree': {
        const item = new vscode.TreeItem(node.worktree.path, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('file-submodule');
        item.description = node.worktree.branch ?? '(detached)';
        item.contextValue = 'gitLore.worktree';
        return item;
      }
      case 'contributor': {
        const item = new vscode.TreeItem(node.contributor.name, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('account');
        item.description = `${node.contributor.commitCount} ${node.contributor.commitCount === 1 ? 'commit' : 'commits'}`;
        return item;
      }
    }
  }

  private branchTreeItem(branch: BranchInfo): vscode.TreeItem {
    const item = new vscode.TreeItem(branch.name, vscode.TreeItemCollapsibleState.None);
    // No colored "current" pill is possible on a native TreeItem — a distinct icon plus a text
    // marker in the description are the two levers actually available.
    item.iconPath = new vscode.ThemeIcon(branch.isCurrent ? 'check' : 'git-branch');
    const track = [branch.ahead ? `↑${branch.ahead}` : undefined, branch.behind ? `↓${branch.behind}` : undefined]
      .filter((part): part is string => part !== undefined)
      .join(' ');
    item.description = [branch.isCurrent ? '(current)' : undefined, track || undefined].filter(Boolean).join(' ');
    item.contextValue = branch.isRemote ? 'gitLore.branch.remote' : branch.isCurrent ? 'gitLore.branch.current' : 'gitLore.branch';
    return item;
  }
}
