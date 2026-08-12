export interface Commit {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  /** ISO 8601 timestamp. */
  date: string;
  message: string;
}

export interface CommitDetail extends Commit {
  /** Full commit message (subject + body) — `Commit.message` is subject-only, for compact list display. */
  body: string;
}

export interface BlameLine {
  /** 0-based line index within the file. */
  line: number;
  sha: string;
  author: string;
  authorEmail: string;
  /** Unix seconds. */
  authorTime: number;
  summary: string;
  isUncommitted: boolean;
}

export interface FileChange {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
}

export interface Ref {
  name: string;
  /**
   * `remoteBranch` is distinguishable from `branch` only when git is asked for
   * `--decorate=full` — the short `%D` form renders both as e.g. `origin/main`.
   */
  type: 'branch' | 'remoteBranch' | 'tag' | 'detached';
  /** True when HEAD currently points at this ref, i.e. the checked-out branch. */
  isHead?: boolean;
}

export interface GraphCommit extends Commit {
  parents: string[];
  refs: Ref[];
  /**
   * Diff stat against the first parent, from the `--numstat` block of the same `git log`
   * call — no extra process per commit. Merge commits report 0 (git emits no numstat for
   * them without `-m`), matching the convention other git tools use for a Changes column.
   */
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** Uncommitted work in the repo, counted by file (not by line) — the standard `+A ~M -D` badge. */
export interface WorkingChanges {
  added: number;
  modified: number;
  deleted: number;
  total: number;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
}

export interface RemoteInfo {
  host: string;
  /** May contain slashes for GitLab-style nested groups (e.g. "group/subgroup"). */
  owner: string;
  repo: string;
}
