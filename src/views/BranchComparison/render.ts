import type { Commit, FileChange } from '../../core/git/types';
import { formatAge } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { renderDiff, renderFileList } from '../diffRender';

export interface RenderBranchComparisonOptions {
  nonce: string;
  cspSource: string;
  styleUri: string;
}

export interface BranchComparisonData {
  base: string;
  compare: string;
  /** Commits `compare` has that `base` doesn't. */
  aheadCommits: Commit[];
  /** Commits `base` has that `compare` doesn't. */
  behindCommits: Commit[];
  files: FileChange[];
  diff: string;
  now?: Date;
}

function renderCommitList(commits: Commit[], now: Date): string {
  if (commits.length === 0) {
    return '<p class="muted">No commits.</p>';
  }
  const items = commits
    .map((c) => {
      const age = formatAge(new Date(c.date), now);
      return `<li class="commit-row" data-sha="${escapeHtml(c.sha)}" tabindex="0" role="button" aria-label="Show commit details for ${escapeHtml(c.message)}"><code>${escapeHtml(c.shortSha)}</code> <span class="commit-message">${escapeHtml(c.message)}</span> <span class="muted">${escapeHtml(c.author)}, ${escapeHtml(age)}</span></li>`;
    })
    .join('\n');
  return `<ul class="commit-list">\n${items}\n</ul>`;
}

/** Builds the branch comparison webview's full HTML document. Pure — nonce/cspSource/styleUri come from the caller, so this is unit-testable without a real webview host. */
export function renderBranchComparisonHtml(data: BranchComparisonData, opts: RenderBranchComparisonOptions): string {
  const { base, compare, aheadCommits, behindCommits, files, diff } = data;
  const now = data.now ?? new Date();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource}; img-src ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
<link rel="stylesheet" href="${opts.styleUri}" />
<title>Compare ${escapeHtml(base)}...${escapeHtml(compare)}</title>
</head>
<body>
<h1>${escapeHtml(base)} <span class="muted">...</span> ${escapeHtml(compare)}</h1>
<p class="summary">${aheadCommits.length} commit${aheadCommits.length === 1 ? '' : 's'} ahead, ${behindCommits.length} commit${behindCommits.length === 1 ? '' : 's'} behind</p>
<h2>Commits in ${escapeHtml(compare)} not in ${escapeHtml(base)}</h2>
${renderCommitList(aheadCommits, now)}
<h2>Commits in ${escapeHtml(base)} not in ${escapeHtml(compare)}</h2>
${renderCommitList(behindCommits, now)}
<h2>Files changed (${files.length})</h2>
${renderFileList(files)}
<h2>Diff</h2>
<pre class="diff" aria-label="Branch comparison diff"><code>${renderDiff(diff)}</code></pre>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
function openRow(row) {
  const sha = row.getAttribute('data-sha');
  if (sha) vscode.postMessage({ type: 'openCommit', sha });
}
for (const row of document.querySelectorAll('.commit-row')) {
  row.addEventListener('click', () => openRow(row));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openRow(row);
    }
  });
}
</script>
</body>
</html>`;
}
