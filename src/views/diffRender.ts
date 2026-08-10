import type { FileChange } from '../core/git/types';
import { escapeHtml } from './escapeHtml';

function renderDiffLine(line: string): string {
  const escaped = escapeHtml(line);
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) {
    return `<span class="diff-meta">${escaped}</span>`;
  }
  if (line.startsWith('+')) {
    return `<span class="diff-add">${escaped}</span>`;
  }
  if (line.startsWith('-')) {
    return `<span class="diff-del">${escaped}</span>`;
  }
  if (line.startsWith('@@')) {
    return `<span class="diff-hunk">${escaped}</span>`;
  }
  return `<span class="diff-ctx">${escaped}</span>`;
}

/** Renders a unified diff as HTML with per-line +/- coloring spans. Escapes each line's content. */
export function renderDiff(diff: string): string {
  return diff.split('\n').map(renderDiffLine).join('\n');
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
 * one undifferentiated dump of the whole commit's diff. Sole-file commits open by default —
 * there is nothing to choose between.
 *
 * `data-filter` carries a lowercased path so the view's filter box can match rows without
 * re-reading their text content.
 */
export function renderFileSections(files: FileChange[], diff: string): string {
  if (files.length === 0) {
    return '<p class="muted">No files changed.</p>';
  }
  const byPath = splitDiffByFile(diff);
  const expandAll = files.length === 1;

  return files
    .map((file) => {
      const slash = file.path.lastIndexOf('/');
      const dir = slash === -1 ? '' : file.path.slice(0, slash + 1);
      const name = file.path.slice(slash + 1);
      const hunks = byPath.get(file.path) ?? '';
      const body = hunks
        ? `<pre class="diff"><code>${renderDiff(hunks)}</code></pre>`
        : '<p class="muted no-diff">No textual diff for this file.</p>';
      return `<details class="file"${expandAll ? ' open' : ''} data-filter="${escapeHtml(file.path.toLowerCase())}">
<summary><span class="file-path" title="${escapeHtml(file.path)}"><span class="file-dir">${escapeHtml(dir)}</span><span class="file-name">${escapeHtml(name)}</span></span><span class="file-stat">${renderFileStat(file)}</span></summary>
${body}
</details>`;
    })
    .join('\n');
}

/** Renders a `FileChange[]` as an HTML list with insertion/deletion counts. */
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
