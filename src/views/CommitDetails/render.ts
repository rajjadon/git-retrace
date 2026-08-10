import type { CommitDetail, FileChange } from '../../core/git/types';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';

export interface RenderCommitDetailsOptions {
  nonce: string;
  cspSource: string;
  styleUri: string;
  editorFontFamily: string;
}

export interface CommitDetailsData {
  commit: CommitDetail;
  files: FileChange[];
  diff: string;
  now?: Date;
}

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

function renderDiff(diff: string): string {
  return diff.split('\n').map(renderDiffLine).join('\n');
}

function renderFileList(files: FileChange[]): string {
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

/** Builds the commit details webview's full HTML document. Pure — nonce/cspSource/styleUri come from the caller, not from vscode APIs directly, so this is unit-testable without a real webview host. */
export function renderCommitDetailsHtml(data: CommitDetailsData, opts: RenderCommitDetailsOptions): string {
  const { commit, files, diff } = data;
  const now = data.now ?? new Date();
  const date = new Date(commit.date);
  const age = formatAge(date, now);
  const absoluteDate = formatAbsolute(date, 'yyyy-MM-dd HH:mm');
  const bodyRest = commit.body.slice(commit.message.length).replace(/^\n+/, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
<link rel="stylesheet" href="${opts.styleUri}" />
<style nonce="${opts.nonce}">:root { --gitsense-editor-font: ${escapeHtml(opts.editorFontFamily)}; }</style>
<title>Commit ${escapeHtml(commit.shortSha)}</title>
</head>
<body>
<h1>${escapeHtml(commit.message)}</h1>
<dl class="meta">
<dt>Author</dt><dd>${escapeHtml(commit.author)}</dd>
<dt>Date</dt><dd>${escapeHtml(age)} &middot; ${escapeHtml(absoluteDate)}</dd>
<dt>SHA</dt><dd><code>${escapeHtml(commit.sha)}</code></dd>
</dl>
${bodyRest ? `<pre class="commit-body">${escapeHtml(bodyRest)}</pre>` : ''}
<button id="copy-sha" type="button">Copy SHA</button>
<h2>Files changed (${files.length})</h2>
${renderFileList(files)}
<h2>Diff</h2>
<pre class="diff" aria-label="Commit diff"><code>${renderDiff(diff)}</code></pre>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
document.getElementById('copy-sha').addEventListener('click', () => {
  vscode.postMessage({ type: 'copySha' });
});
</script>
</body>
</html>`;
}
