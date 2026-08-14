import type { PullRequestSummary } from '../../core/forge/types';
import type { FileChange } from '../../core/git/types';
import { escapeHtml } from '../escapeHtml';
import { renderFileSections } from '../diffRender';
import { EXTERNAL_ICON, FILES_ICON, SEARCH_ICON, WRAP_ICON } from '../icons';

export interface RenderPullRequestDetailsOptions {
  nonce: string;
  cspSource: string;
  /** Shared diff rules first, then the panel's own. */
  styleUris: string[];
}

export interface PullRequestDetailsData {
  pr: PullRequestSummary;
  files: FileChange[];
  diff: string;
}

/** Whole-PR totals for the section header — `0` for every file (Azure DevOps' documented gap, see `AzureDevOpsClient.getPullRequestDiff`) reads the same as "no changes", which is the honest fallback here rather than a misleading non-zero guess. */
function renderTotals(files: FileChange[]): string {
  const insertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
  return `<span class="totals"><span class="stat-add">+${insertions}</span><span class="stat-del">&minus;${deletions}</span></span>`;
}

/** Builds the PR Details webview's full HTML document. Pure — nonce/cspSource/styleUris come from the caller, so this is unit-testable without a real webview host. */
export function renderPullRequestDetailsHtml(data: PullRequestDetailsData, opts: RenderPullRequestDetailsOptions): string {
  const { pr, files, diff } = data;
  const styles = opts.styleUris.map((uri) => `<link rel="stylesheet" href="${uri}" />`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src https: ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
${styles}
<title>${escapeHtml(pr.title)}</title>
</head>
<body>
<div class="head">
<div class="head-text">
<h1 title="${escapeHtml(pr.title)}">${escapeHtml(pr.title)}</h1>
<div class="head-meta"><span class="head-author">${escapeHtml(pr.authorLogin)}</span><span class="head-sep">&middot;</span><span class="head-repo">${escapeHtml(pr.repo.label)}</span></div>
</div>
</div>
<div class="actions">
<button class="btn" id="open-remote" type="button" title="${escapeHtml(pr.url)}">${EXTERNAL_ICON}Open on ${escapeHtml(pr.repo.host)}</button>
</div>
<div class="section-head">
${FILES_ICON}<span class="section-title">Files changed</span><span class="badge">${files.length}</span>
${renderTotals(files)}
<span class="search">${SEARCH_ICON}<input id="file-filter" type="search" placeholder="Filter files…" aria-label="Filter changed files by path" autocomplete="off" spellcheck="false" /></span>
<button class="icon-btn" id="wrap" type="button" aria-pressed="false" title="Wrap long lines" aria-label="Wrap long lines">${WRAP_ICON}</button>
</div>
<div class="files" id="files">
${renderFileSections(files, diff)}
</div>
<p class="empty" id="no-match" hidden>No files match that filter.</p>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();

document.getElementById('open-remote').addEventListener('click', () => {
  vscode.postMessage({ type: 'openRemote' });
});

const wrapBtn = document.getElementById('wrap');
wrapBtn.addEventListener('click', () => {
  const on = document.body.classList.toggle('wrap');
  wrapBtn.setAttribute('aria-pressed', String(on));
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
    if (q !== '' && match) el.open = true;
  }
  noMatchEl.hidden = shown > 0 || fileEls.length === 0;
});
</script>
</body>
</html>`;
}
