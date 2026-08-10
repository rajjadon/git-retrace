import type { FileChange } from '../core/git/types';
import { escapeHtml } from './escapeHtml';
import { OPEN_CHANGES_ICON } from './icons';

/** `@@ -<oldStart>[,<oldCount>] +<newStart>[,<newCount>] @@[ heading]` — the only line in a diff that carries absolute line numbers. */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function classifyDiffLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) {
    return 'diff-meta';
  }
  if (line.startsWith('@@')) {
    return 'diff-hunk';
  }
  if (line.startsWith('+')) {
    return 'diff-add';
  }
  if (line.startsWith('-')) {
    return 'diff-del';
  }
  return 'diff-ctx';
}

/** One gutter cell. Empty for the side a line doesn't exist on — an added line has no old number. */
function gutter(value: number | null, side: 'old' | 'new'): string {
  return `<span class="dn dn-${side}">${value === null ? '' : value}</span>`;
}

/**
 * Renders a unified diff as HTML: one grid row per line, with the old and new absolute line
 * numbers in a two-column gutter and the line's content in the third column. Escapes every line.
 *
 * The numbers come from each hunk's `@@ -a,b +c,d @@` header, which is the only place git states
 * them — so a diff with no hunk header (a binary stub, or a fragment) simply renders with empty
 * gutters rather than guessing. Rows are concatenated with no separator: each `.dl` is a grid
 * (block) box, so an interleaved newline inside the `<pre>` would render as a second blank line.
 */
export function renderDiff(diff: string): string {
  let oldLine = 0;
  let newLine = 0;
  let numbering = false;

  // A trailing newline is an artifact of the capture, not a line of the diff.
  const lines = diff.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines
    .map((line) => {
      const cls = classifyDiffLine(line);
      let oldNum: number | null = null;
      let newNum: number | null = null;

      const hunk = HUNK_HEADER_RE.exec(line);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        numbering = true;
      } else if (numbering && cls === 'diff-add') {
        newNum = newLine++;
      } else if (numbering && cls === 'diff-del') {
        oldNum = oldLine++;
      } else if (numbering && cls === 'diff-ctx' && !line.startsWith('\\')) {
        // `\ No newline at end of file` is a note about the previous line, not a line of its own.
        oldNum = oldLine++;
        newNum = newLine++;
      }

      return `<span class="dl">${gutter(oldNum, 'old')}${gutter(newNum, 'new')}<span class="dc ${cls}">${escapeHtml(line)}</span></span>`;
    })
    .join('');
}

/**
 * Extracts the post-image path from a `diff --git a/<x> b/<y>` header line, or null if `line`
 * isn't such a header. The identical-path form is matched first via a backreference so paths
 * containing spaces — which a naive split on `" b/"` mangles — round-trip correctly.
 */
function parseDiffHeaderPath(line: string): string | null {
  if (!line.startsWith('diff --git ')) {
    return null;
  }
  const rest = line.slice('diff --git '.length);
  const same = /^a\/(.*) b\/\1$/.exec(rest);
  if (same) {
    return same[1] ?? rest;
  }
  const renamed = /^a\/.* b\/(.*)$/.exec(rest);
  return renamed?.[1] ?? rest;
}

/**
 * Splits a multi-file unified diff into one hunk body per path, dropping the per-file header
 * noise (`diff --git`, `index`, `---`/`+++`, mode and rename lines) that carries no information
 * a reader can't get from the filename already shown above it. Pure — no I/O.
 *
 * A path maps to `''` when git emitted no hunks for it (binary files, pure mode changes).
 */
export function splitDiffByFile(diff: string): Map<string, string> {
  const sections = new Map<string, string>();
  let path: string | undefined;
  let body: string[] = [];

  const flush = (): void => {
    if (path !== undefined) {
      sections.set(path, body.join('\n'));
    }
  };

  for (const line of diff.split('\n')) {
    const headerPath = parseDiffHeaderPath(line);
    if (headerPath !== null) {
      flush();
      path = headerPath;
      body = [];
      continue;
    }
    if (path === undefined) {
      continue;
    }
    // Collect from the first hunk marker onward — everything before it is header metadata.
    if (line.startsWith('@@') || body.length > 0) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

function renderFileStat(file: FileChange): string {
  if (file.binary) {
    return '<span class="muted">binary</span>';
  }
  return `<span class="stat-add">+${file.insertions}</span><span class="stat-del">&minus;${file.deletions}</span>`;
}

/**
 * Renders each changed file as a collapsible section holding only that file's hunks, instead of
 * one undifferentiated dump of the whole diff. Sole-file changes open by default — there is
 * nothing to choose between.
 *
 * Each row carries an "Open changes" button that hands off to a real diff editor, because syntax
 * highlighting, folding and go-to-definition are things a webview `<pre>` will never have.
 * `data-filter` carries a lowercased path so the filter box can match rows without re-reading
 * their text content.
 */
export function renderFileSections(files: FileChange[], diff: string): string {
  if (files.length === 0) {
    return '<p class="empty">No files changed.</p>';
  }
  const byPath = splitDiffByFile(diff);
  const expandAll = files.length === 1;

  return files
    .map((file) => {
      const slash = file.path.lastIndexOf('/');
      const dir = slash === -1 ? '' : file.path.slice(0, slash + 1);
      const name = file.path.slice(slash + 1);
      const hunks = byPath.get(file.path) ?? '';
      const escapedPath = escapeHtml(file.path);
      const body = hunks
        ? `<pre class="diff">${renderDiff(hunks)}</pre>`
        : '<p class="muted no-diff">No textual diff for this file.</p>';
      return `<details class="file"${expandAll ? ' open' : ''} data-filter="${escapeHtml(file.path.toLowerCase())}">
<summary><span class="file-path" title="${escapedPath}"><span class="file-dir">${escapeHtml(dir)}</span><span class="file-name">${escapeHtml(name)}</span></span><span class="file-stat">${renderFileStat(file)}</span><button class="row-btn" type="button" data-path="${escapedPath}" title="Open changes" aria-label="Open changes in ${escapedPath}">${OPEN_CHANGES_ICON}</button></summary>
${body}
</details>`;
    })
    .join('\n');
}

/** Renders a `FileChange[]` as a flat HTML list with insertion/deletion counts. */
export function renderFileList(files: FileChange[]): string {
  if (files.length === 0) {
    return '<p class="muted">No files changed.</p>';
  }
  const items = files
    .map((f) => {
      const stat = f.binary
        ? '<span class="muted">binary</span>'
        : `<span class="stat-add">+${f.insertions}</span> <span class="stat-del">-${f.deletions}</span>`;
      return `<li><code>${escapeHtml(f.path)}</code> ${stat}</li>`;
    })
    .join('\n');
  return `<ul class="file-list">\n${items}\n</ul>`;
}
