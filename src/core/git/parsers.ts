import type { BlameLine, Commit, CommitDetail, FileChange } from './types';

const UNCOMMITTED_SHA = '0000000000000000000000000000000000000000';
const HEADER_RE = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/;

// ASCII unit/record separators — control characters that essentially never appear in real
// commit metadata, so they're safe delimiters even when author names or subjects contain
// tabs, pipes, or other "normal" punctuation.
const LOG_FIELD_SEP = '\x1f';
const LOG_RECORD_SEP = '\x1e';

/** Pass to `git log --pretty=tformat:<this>` — `tformat` (not `format`) avoids an extra implicit newline between records. */
export const LOG_FORMAT = `%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%aI${LOG_FIELD_SEP}%s${LOG_RECORD_SEP}`;

/**
 * Pass to `git show -s --pretty=tformat:<this>` for a single commit's full detail. `%B` (the
 * raw, unwrapped body) is deliberately last and unterminated — it can contain newlines (and,
 * astronomically unlikely but handled anyway, the field separator itself), so parseCommitDetail
 * treats everything after the 5th separator as the body rather than splitting on it.
 */
export const COMMIT_DETAIL_FORMAT = `%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%aI${LOG_FIELD_SEP}%B`;

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
