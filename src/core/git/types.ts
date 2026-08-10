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
  type: 'branch' | 'tag' | 'detached';
}
