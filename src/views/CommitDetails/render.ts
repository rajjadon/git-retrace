import type { CommitDetail, FileChange } from '../../core/git/types';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { renderDiff, renderFileList } from '../diffRender';
import { linkifyIssues, type IssueLinkOptions } from '../../utils/issueLinks';
import { buildGravatarUrl } from '../../utils/gravatar';
import { FILES_ICON, DIFF_ICON } from '../icons';

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

/** Builds the commit details webview's full HTML document. Pure — nonce/cspSource/styleUri come from the caller, not from vscode APIs directly, so this is unit-testable without a real webview host. */
export function renderCommitDetailsHtml(data: CommitDetailsData, opts: RenderCommitDetailsOptions): string {
  const { commit, files, diff } = data;
  const now = data.now ?? new Date();
  const date = new Date(commit.date);
  const age = formatAge(date, now);
  const absoluteDate = formatAbsolute(date, 'yyyy-MM-dd HH:mm');
  const bodyRest = commit.body.slice(commit.message.length).replace(/^\n+/, '');
  const avatarUrl = buildGravatarUrl(commit.authorEmail, { size: 64 });

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
<div class="header">
<img class="avatar" src="${avatarUrl}" alt="" width="40" height="40" />
<div class="header-text">
<h1>${linkifyHtml(commit.message, opts.issueLinking)}</h1>
<div class="header-meta">
<span class="header-author">${escapeHtml(commit.author)}</span>
<span class="header-sep">&middot;</span>
<span class="header-age" title="${escapeHtml(absoluteDate)}">${escapeHtml(age)}</span>
</div>
</div>
</div>
${bodyRest ? `<pre class="commit-body">${linkifyHtml(bodyRest, opts.issueLinking)}</pre>` : ''}
<div class="toolbar">
<code class="sha">${escapeHtml(commit.sha)}</code>
<button id="copy-sha" type="button" aria-label="Copy commit SHA" title="Copy commit SHA">Copy SHA</button>
</div>
<h2>${FILES_ICON}Files changed (${files.length})</h2>
${renderFileList(files)}
<h2>${DIFF_ICON}Diff</h2>
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
