import type { BranchInfo, ContributorInfo, GitRemote, StashInfo, TagInfo, WorktreeInfo } from '../git/types';

export type ExplorerLeafNode =
  | { kind: 'branch'; branch: BranchInfo }
  | { kind: 'remote'; remote: GitRemote }
  | { kind: 'tag'; tag: TagInfo }
  | { kind: 'stash'; stash: StashInfo }
  | { kind: 'worktree'; worktree: WorktreeInfo }
  | { kind: 'contributor'; contributor: ContributorInfo };

export interface ExplorerSectionNode {
  kind: 'section';
  id: string;
  label: string;
  children: ExplorerLeafNode[];
}

export type ExplorerNode = ExplorerSectionNode | ExplorerLeafNode;

export interface ExplorerData {
  branches: BranchInfo[];
  remotes: GitRemote[];
  tags: TagInfo[];
  stashes: StashInfo[];
  worktrees: WorktreeInfo[];
  contributors: ContributorInfo[];
}

/**
 * Builds the Sidebar Explorer's six-section root: Branches, Remotes, Tags, Stashes, Worktrees,
 * Contributors — one tree, not six separate views, matching the reference mockup. Pure — no
 * `vscode` imports, so the tree shape is unit-testable without a real `TreeDataProvider`; mapping
 * a node to an actual `vscode.TreeItem` (icons, collapsible state) is the provider's job.
 */
export function buildExplorerSections(data: ExplorerData): ExplorerSectionNode[] {
  return [
    {
      kind: 'section',
      id: 'branches',
      label: 'Branches',
      children: data.branches.map((branch) => ({ kind: 'branch', branch })),
    },
    {
      kind: 'section',
      id: 'remotes',
      label: 'Remotes',
      children: data.remotes.map((remote) => ({ kind: 'remote', remote })),
    },
    {
      kind: 'section',
      id: 'tags',
      label: 'Tags',
      children: data.tags.map((tag) => ({ kind: 'tag', tag })),
    },
    {
      kind: 'section',
      id: 'stashes',
      label: 'Stashes',
      children: data.stashes.map((stash) => ({ kind: 'stash', stash })),
    },
    {
      kind: 'section',
      id: 'worktrees',
      label: 'Worktrees',
      children: data.worktrees.map((worktree) => ({ kind: 'worktree', worktree })),
    },
    {
      kind: 'section',
      id: 'contributors',
      label: 'Contributors',
      children: data.contributors.map((contributor) => ({ kind: 'contributor', contributor })),
    },
  ];
}
