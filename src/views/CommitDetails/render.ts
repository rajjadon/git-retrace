import type { CommitDetail, FileChange } from '../../core/git/types';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { renderDiff, renderFileList } from '../diffRender';

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
