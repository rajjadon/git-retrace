import type {
  BlameLine,
  BranchInfo,
  Commit,
  CommitDetail,
  ContributorInfo,
  FileChange,
  FileHistoryEntry,
  GitRemote,
  GraphCommit,
  Ref,
  RemoteInfo,
  StashInfo,
  TagInfo,
  WorkingChanges,
  WorktreeInfo,
} from './types';

const UNCOMMITTED_SHA = '0000000000000000000000000000000000000000';
const HEADER_RE = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/;

// ASCII unit/record separators — control characters that essentially never appear in real
// commit metadata, so they're safe delimiters even when author names or subjects contain
// tabs, pipes, or other "normal" punctuation.
const LOG_FIELD_SEP = '\x1f';
const LOG_RECORD_SEP = '\x1e';

// `--numstat` splits a commit's output across several lines, so the graph parser tokenizes on
// newlines as well as record separators and then classifies each token by whether it carries
// field separators. Splitting on both means it doesn't matter which terminator git emitted.
const RECORD_OR_NEWLINE_RE = /[\n\x1e]/;

/** Pass to `git log --pretty=tformat:<this>` — `tformat` (not `format`) avoids an extra implicit newline between records. */
export const LOG_FORMAT = `%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%aI${LOG_FIELD_SEP}%s${LOG_RECORD_SEP}`;

/**
 * Pass to `git show -s --pretty=tformat:<this>` for a single commit's full detail. `%B` (the
 * raw, unwrapped body) is deliberately last and unterminated — it can contain newlines (and,
 * astronomically unlikely but handled anyway, the field separator itself), so parseCommitDetail
 * treats everything after the 5th separator as the body rather than splitting on it.
 */
export const COMMIT_DETAIL_FORMAT = `%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%aI${LOG_FIELD_SEP}%B`;

/** Pass to `git log --all --topo-order --numstat --decorate=full --pretty=tformat:<this>` for the commit graph. `%P` = parent shas (space-separated), `%D` = ref decorations. */
export const GRAPH_LOG_FORMAT = `%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%aI${LOG_FIELD_SEP}%P${LOG_FIELD_SEP}%D${LOG_FIELD_SEP}%s${LOG_RECORD_SEP}`;

/** Pass to `git for-each-ref refs/heads refs/remotes --format=<this>`. Uses the full refname (not `:short`) so local vs remote can be told apart reliably by prefix. `%(upstream:track)` lets git compute ahead/behind itself — no per-branch `rev-list --count` calls. */
export const BRANCH_FORMAT = `%(refname)${LOG_FIELD_SEP}%(HEAD)${LOG_FIELD_SEP}%(upstream:track)`;

/**
 * Pass to `git log --format=<this> -L <n>,<n>:<file>` for the hover's line-history stepper.
 * Unlike `LOG_FORMAT`, the record separator comes *first*: `-L` always follows each commit's
 * formatted line with a unified-diff hunk, so there's no clean spot after the fields to end the
 * record. Leading with the separator instead means the fields are always the first line of the
 * chunk that follows it — `parseLineHistoryLog` takes that line and discards the hunk after it.
 */
export const LINE_HISTORY_FORMAT = `${LOG_RECORD_SEP}%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%aI${LOG_FIELD_SEP}%s`;

/**
 * Parses `git blame --line-porcelain` output. Pure — no I/O.
 *
 * With `--line-porcelain` (unlike plain `--porcelain`) git always repeats full
 * commit metadata for every line, so each entry is: a header line, a run of
 * `key value` metadata lines, then exactly one `\t`-prefixed content line.
 */
export function parseBlamePorcelain(raw: string): BlameLine[] {
  const lines = raw.split('\n');
  const results: BlameLine[] = [];

  let i = 0;
  while (i < lines.length) {
    const headerLine = lines[i] ?? '';
    const header = HEADER_RE.exec(headerLine);
    if (!header) {
      // Not a header where we expect one — skip forward defensively rather than throwing.
      i += 1;
      continue;
    }

    const sha = header[1] ?? '';
    const finalLine = Number(header[3] ?? '0');

    let author = '';
    let authorEmail = '';
    let authorTime = 0;
    let summary = '';

    i += 1;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (line.startsWith('\t')) {
        // Content line — end of this entry's metadata.
        results.push({
          line: finalLine - 1,
          sha,
          author,
          authorEmail,
          authorTime,
          summary,
          isUncommitted: sha === UNCOMMITTED_SHA,
        });
        i += 1;
        break;
      }

      const spaceIdx = line.indexOf(' ');
      const key = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
      const value = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1);

      switch (key) {
        case 'author':
          author = value;
          break;
        case 'author-mail':
          authorEmail = value.replace(/^</, '').replace(/>$/, '');
          break;
        case 'author-time':
          authorTime = Number(value) || 0;
          break;
        case 'summary':
          summary = value;
          break;
        default:
          // committer-*, previous, filename, boundary — not needed for BlameLine.
          break;
      }

      i += 1;
    }
  }

  return results;
}

/** Parses `git log --pretty=tformat:LOG_FORMAT` output into commits, newest first. Pure — no I/O. */
export function parseLog(raw: string): Commit[] {
  return raw
    .split(LOG_RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, shortSha, author, authorEmail, date, message] = record.split(LOG_FIELD_SEP);
      return {
        sha: sha ?? '',
        shortSha: shortSha ?? '',
        author: author ?? '',
        authorEmail: authorEmail ?? '',
        date: date ?? '',
        message: message ?? '',
      };
    });
}

/**
 * Parses `git log --format=LINE_HISTORY_FORMAT -L <n>,<n>:<file>` output: one commit's fields
 * per chunk, immediately followed by a unified-diff hunk this parser discards — the hover's
 * prev/next stepper only needs commit metadata, not the hunk text. Newest first, same as
 * `parseLog`. Pure — no I/O.
 */
export function parseLineHistoryLog(raw: string): Commit[] {
  return raw
    .split(LOG_RECORD_SEP)
    .map((chunk) => chunk.split('\n')[0] ?? '')
    .filter((line) => line.includes(LOG_FIELD_SEP))
    .map((fieldsLine) => {
      const [sha, shortSha, author, authorEmail, date, message] = fieldsLine.split(LOG_FIELD_SEP);
      return {
        sha: sha ?? '',
        shortSha: shortSha ?? '',
        author: author ?? '',
        authorEmail: authorEmail ?? '',
        date: date ?? '',
        message: message ?? '',
      };
    });
}

/** Classifies one decoration segment. Handles both `--decorate=full` refnames (`refs/heads/main`) and the short `%D` form (`main`), so callers that omit `--decorate=full` still get usable refs — just without local/remote separation. */
function parseRefSegment(segment: string, isHead: boolean): Ref {
  // The `tag: ` marker is git's own, present in both decoration forms — it must be checked before
  // the refname prefixes, because the short form's payload (`tag: v1.0.0`) carries no `refs/tags/`
  // prefix to fall back on and would otherwise be misfiled as a branch.
  if (segment.startsWith('tag: ')) {
    return { name: segment.slice('tag: '.length).replace(/^refs\/tags\//, ''), type: 'tag', isHead };
  }
  if (segment.startsWith('refs/heads/')) {
    return { name: segment.slice('refs/heads/'.length), type: 'branch', isHead };
  }
  if (segment.startsWith('refs/remotes/')) {
    return { name: segment.slice('refs/remotes/'.length), type: 'remoteBranch', isHead };
  }
  if (segment.startsWith('refs/tags/')) {
    return { name: segment.slice('refs/tags/'.length), type: 'tag', isHead };
  }
  return { name: segment, type: 'branch', isHead };
}

/** Parses a `%D` ref-decoration string, e.g. "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0.0". Pure — no I/O. */
function parseRefs(raw: string): Ref[] {
  if (!raw) {
    return [];
  }
  return raw.split(', ').map((segment): Ref => {
    if (segment === 'HEAD') {
      return { name: 'HEAD', type: 'detached', isHead: true };
    }
    if (segment.startsWith('HEAD -> ')) {
      return parseRefSegment(segment.slice('HEAD -> '.length), true);
    }
    return parseRefSegment(segment, false);
  });
}

function parseGraphRecord(fieldsLine: string): GraphCommit {
  const [sha, shortSha, author, authorEmail, date, parentsRaw, refsRaw, message] = fieldsLine.split(LOG_FIELD_SEP);
  return {
    sha: sha ?? '',
    shortSha: shortSha ?? '',
    author: author ?? '',
    authorEmail: authorEmail ?? '',
    date: date ?? '',
    message: message ?? '',
    parents: (parentsRaw ?? '').split(' ').filter((p) => p.length > 0),
    refs: parseRefs(refsRaw ?? ''),
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  };
}

/**
 * Parses `git log --all --numstat --decorate=full --pretty=tformat:GRAPH_LOG_FORMAT` output.
 * Pure — no I/O.
 *
 * With `--numstat`, git interleaves each commit's stat block *after* its formatted record, so a
 * naive split on the record separator would attach every block to the wrong commit. Instead this
 * walks the output line by line: a line containing the field separator starts a new commit, and
 * any other non-empty line is a numstat row folded into the commit most recently started. That
 * also makes the parser indifferent to whether `--numstat` was passed at all.
 */
export function parseGraphLog(raw: string): GraphCommit[] {
  const commits: GraphCommit[] = [];
  for (const segment of raw.split(RECORD_OR_NEWLINE_RE)) {
    const line = segment.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.includes(LOG_FIELD_SEP)) {
      commits.push(parseGraphRecord(line));
      continue;
    }
    const stat = parseNumstatLine(line);
    const current = commits[commits.length - 1];
    if (stat && current) {
      current.filesChanged += 1;
      current.insertions += stat.insertions;
      current.deletions += stat.deletions;
    }
  }
  return commits;
}

function parseFileHistoryRecord(fieldsLine: string): FileHistoryEntry {
  const [sha, shortSha, author, authorEmail, date, message] = fieldsLine.split(LOG_FIELD_SEP);
  return {
    sha: sha ?? '',
    shortSha: shortSha ?? '',
    author: author ?? '',
    authorEmail: authorEmail ?? '',
    date: date ?? '',
    message: message ?? '',
    insertions: 0,
    deletions: 0,
  };
}

/**
 * Parses `git log --follow --numstat --pretty=tformat:LOG_FORMAT -- <path>` output for the Visual
 * File History timeline. Pure — no I/O.
 *
 * Scoping `--numstat` to a single path means git emits at most one stat line per commit, but the
 * interleaving is the same shape `parseGraphLog` already handles (stat block follows the record,
 * not precedes it) — same line-by-line walk, reused rather than re-derived.
 */
export function parseFileHistoryLog(raw: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = [];
  for (const segment of raw.split(RECORD_OR_NEWLINE_RE)) {
    const line = segment.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.includes(LOG_FIELD_SEP)) {
      entries.push(parseFileHistoryRecord(line));
      continue;
    }
    const stat = parseNumstatLine(line);
    const current = entries[entries.length - 1];
    if (stat && current) {
      current.insertions += stat.insertions;
      current.deletions += stat.deletions;
    }
  }
  return entries;
}

/**
 * Parses `git status --porcelain` output into per-status *file* counts. Pure — no I/O.
 *
 * Counts each path once by its most significant status across the index (X) and worktree (Y)
 * columns: deleted wins over added wins over modified, so a file that is staged-added and then
 * worktree-modified is still counted once, as added.
 */
export function parseStatusPorcelain(raw: string): WorkingChanges {
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const line of raw.split('\n')) {
    // Status codes live in columns 0-1; anything shorter than `XY path` isn't a status line.
    if (line.length < 4) {
      continue;
    }
    const codes = line.slice(0, 2);
    if (codes.includes('D')) {
      deleted += 1;
    } else if (codes === '??' || codes.includes('A')) {
      added += 1;
    } else {
      modified += 1;
    }
  }
  return { added, modified, deleted, total: added + modified + deleted };
}

/** Parses `git show -s --pretty=tformat:COMMIT_DETAIL_FORMAT <sha>` output. Pure — no I/O. */
export function parseCommitDetail(raw: string): CommitDetail | null {
  const fields: string[] = [];
  let rest = raw;
  for (let i = 0; i < 5; i++) {
    const idx = rest.indexOf(LOG_FIELD_SEP);
    if (idx === -1) {
      return null;
    }
    fields.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  const [sha, shortSha, author, authorEmail, date] = fields;
  if (!sha) {
    return null;
  }
  const body = rest.replace(/\n+$/, '');
  return {
    sha,
    shortSha: shortSha ?? '',
    author: author ?? '',
    authorEmail: authorEmail ?? '',
    date: date ?? '',
    message: body.split('\n')[0] ?? '',
    body,
  };
}

/** Parses one line of `git show/diff --numstat` output: `<insertions>\t<deletions>\t<path>`. Binary files report `-` for both counts. */
function parseNumstatLine(line: string): FileChange | null {
  const [insertionsRaw, deletionsRaw, path] = line.split('\t');
  if (path === undefined) {
    return null;
  }
  const binary = insertionsRaw === '-' || deletionsRaw === '-';
  return {
    path,
    insertions: binary ? 0 : Number(insertionsRaw),
    deletions: binary ? 0 : Number(deletionsRaw),
    binary,
  };
}

/** Parses `git show/diff --numstat` output for a single file's stat (the first line). Pure — no I/O. */
export function parseNumstat(raw: string): FileChange | null {
  const line = raw.trim().split('\n')[0];
  return line ? parseNumstatLine(line) : null;
}

/** Parses `git show/diff --numstat` output for every changed file in a commit. Pure — no I/O. */
export function parseNumstatAll(raw: string): FileChange[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseNumstatLine)
    .filter((change): change is FileChange => change !== null);
}

/** Parses `git for-each-ref --format=BRANCH_FORMAT` output. Filters out the `origin/HEAD` symbolic alias. Pure — no I/O. */
/**
 * Parses git's `%(upstream:track)` value, e.g. `[ahead 2, behind 1]`, `[ahead 2]`, `[gone]`, or
 * empty (no upstream, or up to date). Only includes the keys git actually reported — a branch
 * with no upstream carries neither `ahead` nor `behind`, not zeros.
 */
function parseUpstreamTrack(raw: string): Pick<BranchInfo, 'ahead' | 'behind'> {
  const ahead = /ahead (\d+)/.exec(raw);
  const behind = /behind (\d+)/.exec(raw);
  return {
    ...(ahead ? { ahead: Number(ahead[1]) } : {}),
    ...(behind ? { behind: Number(behind[1]) } : {}),
  };
}

export function parseBranches(raw: string): BranchInfo[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [refname, headMarker, track] = line.split(LOG_FIELD_SEP);
      const isRemote = (refname ?? '').startsWith('refs/remotes/');
      const name = (refname ?? '').replace(/^refs\/(heads|remotes)\//, '');
      return { name, isRemote, isCurrent: headMarker === '*', ...parseUpstreamTrack(track ?? '') };
    })
    .filter((branch) => branch.name !== 'HEAD' && !branch.name.endsWith('/HEAD'));
}

/** Parses `git config --get-regexp "remote\..*\.url"` output: `remote.<name>.url <url>` per line. Pure — no I/O. */
export function parseRemotes(raw: string): GitRemote[] {
  const remotes: GitRemote[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, spaceIdx);
    const url = trimmed.slice(spaceIdx + 1);
    const match = /^remote\.(.+)\.url$/.exec(key);
    if (match?.[1]) {
      remotes.push({ name: match[1], url });
    }
  }
  return remotes;
}

/** Parses `git for-each-ref refs/tags --format=%(refname:short)` output: one tag name per line. Pure — no I/O. */
export function parseTags(raw: string): TagInfo[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name }));
}

/** Parses `git stash list --format=%gd<FIELD>%s` output, extracting the numeric index from `stash@{N}` — what `git stash apply/drop` expects. Pure — no I/O. */
export function parseStashes(raw: string): StashInfo[] {
  const stashes: StashInfo[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [ref, message] = line.split(LOG_FIELD_SEP);
    const match = /stash@\{(\d+)\}/.exec(ref ?? '');
    if (match?.[1]) {
      stashes.push({ index: Number(match[1]), message: message ?? '' });
    }
  }
  return stashes;
}

/**
 * Parses `git worktree list --porcelain` output: blank-line-separated blocks, each starting with
 * `worktree <path>`. The first block is always the main checkout, never a linked worktree. Pure
 * — no I/O.
 */
export function parseWorktrees(raw: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: { path: string; branch: string | null } | null = null;
  let isFirst = true;

  const flush = (): void => {
    if (current) {
      worktrees.push({ path: current.path, branch: current.branch, isMain: isFirst });
      isFirst = false;
    }
    current = null;
  };

  for (const line of raw.split('\n')) {
    if (line.trim() === '') {
      flush();
    } else if (line.startsWith('worktree ')) {
      flush();
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    }
    // `HEAD <sha>`, `bare`, `locked`, `prunable` lines are ignored for v1 — read-only display
    // doesn't need them yet.
  }
  flush();
  return worktrees;
}

/** Parses `git shortlog -sne HEAD` output: `<count>\t<name> <email>` per line. Pure — no I/O. */
export function parseContributors(raw: string): ContributorInfo[] {
  const contributors: ContributorInfo[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^(\d+)\s+(.+?)\s+<(.+)>$/.exec(trimmed);
    if (match?.[1] && match[2] && match[3]) {
      contributors.push({ commitCount: Number(match[1]), name: match[2], email: match[3] });
    }
  }
  return contributors;
}

/**
 * Parses a git remote URL (`https://host/owner/repo.git`, `git@host:owner/repo.git`, or
 * `ssh://git@host[:port]/owner/repo.git`) into host/owner/repo. `owner` may contain slashes
 * for GitLab-style nested groups. Pure — no I/O.
 */
export function parseRemoteUrl(url: string): RemoteInfo | null {
  const rest = url.trim().replace(/\.git\/?$/, '');

  let host: string | undefined;
  let path: string | undefined;

  const schemeMatch = /^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(rest);
  if (schemeMatch) {
    [, host, path] = schemeMatch;
  } else {
    const scpMatch = /^(?:[^@]+@)?([^:/]+):(.+)$/.exec(rest);
    if (scpMatch) {
      [, host, path] = scpMatch;
    }
  }
  if (!host || !path) {
    return null;
  }

  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) {
    return null;
  }
  const repo = segments[segments.length - 1] ?? '';
  const owner = segments.slice(0, -1).join('/');
  return { host, owner, repo };
}
