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
