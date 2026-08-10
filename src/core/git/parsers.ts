import type {
  BlameLine,
  BranchInfo,
  Commit,
  CommitDetail,
  FileChange,
  GraphCommit,
  Ref,
  RemoteInfo,
  WorkingChanges,
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

/** Pass to `git for-each-ref refs/heads refs/remotes --format=<this>`. Uses the full refname (not `:short`) so local vs remote can be told apart reliably by prefix. */
export const BRANCH_FORMAT = `%(refname)${LOG_FIELD_SEP}%(HEAD)`;

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
export function parseBranches(raw: string): BranchInfo[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [refname, headMarker] = line.split(LOG_FIELD_SEP);
      const isRemote = (refname ?? '').startsWith('refs/remotes/');
      const name = (refname ?? '').replace(/^refs\/(heads|remotes)\//, '');
      return { name, isRemote, isCurrent: headMarker === '*' };
    })
    .filter((branch) => branch.name !== 'HEAD' && !branch.name.endsWith('/HEAD'));
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
