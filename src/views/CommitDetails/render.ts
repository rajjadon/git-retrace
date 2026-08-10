import type { CommitDetail, FileChange } from '../../core/git/types';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { renderFileSections } from '../diffRender';
import { linkifyIssues, type IssueLinkOptions } from '../../utils/issueLinks';
import { buildGravatarUrl } from '../../utils/gravatar';
import { COPY_ICON, FILES_ICON, SEARCH_ICON } from '../icons';

export interface RenderCommitDetailsOptions {
  nonce: string;
  cspSource: string;
  styleUri: string;
  editorFontFamily: string;
  issueLinking?: IssueLinkOptions | null;
}

/** Escapes `text` as HTML, wrapping any issue references per `issueLinking` in a real `<a>` link. */
function linkifyHtml(text: string, issueLinking: IssueLinkOptions | null | undefined): string {
  if (!issueLinking) {
    return escapeHtml(text);
  }
  return linkifyIssues(text, issueLinking.pattern, issueLinking.urlTemplate)
    .map((segment) =>
      segment.url
        ? `<a href="${escapeHtml(segment.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(segment.text)}</a>`
        : escapeHtml(segment.text),
    )
    .join('');
}

export interface CommitDetailsData {
  commit: CommitDetail;
  files: FileChange[];
  diff: string;
  now?: Date;
}

/** Whole-commit totals for the section header, so the size of a change is legible without expanding anything. */
function renderTotals(files: FileChange[]): string {
  const insertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
  return `<span class="totals"><span class="stat-add">+${insertions}</span><span class="stat-del">&minus;${deletions}</span></span>`;
}

/** Builds the commit details webview's full HTML document. Pure — nonce/cspSource/styleUri come from the caller, not from vscode APIs directly, so this is unit-testable without a real webview host. */
export function renderCommitDetailsHtml(data: CommitDetailsData, opts: RenderCommitDetailsOptions): string {
  const { commit, files, diff } = data;
  const now = data.now ?? new Date();
  const date = new Date(commit.date);
  const age = formatAge(date, now);
  const absoluteDate = formatAbsolute(date, 'yyyy-MM-dd HH:mm');
  const bodyRest = commit.body.slice(commit.message.length).replace(/^\n+/, '');
  const avatarUrl = buildGravatarUrl(commit.authorEmail, { size: 56 });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src https: ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
<link rel="stylesheet" href="${opts.styleUri}" />
<style nonce="${opts.nonce}">:root { --gitsense-editor-font: ${escapeHtml(opts.editorFontFamily)}; }</style>
<title>Commit ${escapeHtml(commit.shortSha)}</title>
</head>
<body>
<div class="head">
<img class="avatar" src="${avatarUrl}" alt="" width="28" height="28" />
<div class="head-text">
<h1>${linkifyHtml(commit.message, opts.issueLinking)}</h1>
<div class="head-meta"><span class="head-author">${escapeHtml(commit.author)}</span><span class="head-sep">&middot;</span><span class="head-age" title="${escapeHtml(absoluteDate)}">${escapeHtml(age)}</span></div>
</div>
<div class="head-actions">
<code class="sha" title="${escapeHtml(commit.sha)}">${escapeHtml(commit.shortSha)}</code>
<button id="copy-sha" class="icon-btn" type="button" aria-label="Copy commit SHA" title="Copy commit SHA">${COPY_ICON}</button>
</div>
</div>
${bodyRest ? `<pre class="commit-body">${linkifyHtml(bodyRest, opts.issueLinking)}</pre>` : ''}
<div class="section-head">
${FILES_ICON}<span class="section-title">Files changed</span><span class="badge">${files.length}</span>
${renderTotals(files)}
<span class="search">${SEARCH_ICON}<input id="file-filter" type="search" placeholder="Filter files…" aria-label="Filter changed files by path" autocomplete="off" spellcheck="false" /></span>
</div>
<div class="files" id="files">
${renderFileSections(files, diff)}
</div>
<p class="empty" id="no-match" hidden>No files match that filter.</p>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
document.getElementById('copy-sha').addEventListener('click', () => {
  vscode.postMessage({ type: 'copySha' });
});

const filterEl = document.getElementById('file-filter');
const fileEls = Array.from(document.querySelectorAll('.files .file'));
const noMatchEl = document.getElementById('no-match');
filterEl.addEventListener('input', () => {
  const q = filterEl.value.trim().toLowerCase();
  let shown = 0;
  for (const el of fileEls) {
    const match = q === '' || el.dataset.filter.includes(q);
    el.hidden = !match;
    if (match) shown += 1;
    // Expand matches while filtering: with the list narrowed to a handful of files, the
    // extra click to see each one is pure friction.
    if (q !== '' && match) el.open = true;
  }
  noMatchEl.hidden = shown > 0 || fileEls.length === 0;
});
</script>
</body>
</html>`;
}
