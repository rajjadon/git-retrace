import { LAUNCHPAD_BUCKETS, pullRequestKey } from '../../core/forge/types';
import type { CategorizedPullRequest, ForgeRepoRef, LaunchpadBucket, PullRequestSummary } from '../../core/forge/types';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { AUTHOR_ICON, REFRESH_ICON, SNOOZE_ICON } from '../icons';

export interface RenderLaunchpadOptions {
  nonce: string;
  cspSource: string;
  styleUris: string[];
}

export interface LaunchpadRepoError {
  repo: ForgeRepoRef;
  message: string;
}

export interface LaunchpadData {
  categorized: CategorizedPullRequest[];
  errors: LaunchpadRepoError[];
  now?: Date;
}

const BUCKET_LABELS: Record<LaunchpadBucket, string> = {
  needsReview: 'Needs Review',
  readyToMerge: 'Ready to Merge',
  waiting: 'Waiting',
  blocked: 'Blocked',
  drafts: 'Drafts',
  snoozed: 'Snoozed',
};

function renderCard(pr: PullRequestSummary, now: Date, isSnoozedColumn: boolean): string {
  const key = pullRequestKey(pr);
  const date = new Date(pr.createdAt);
  const age = formatAge(date, now);
  const absolute = formatAbsolute(date, 'yyyy-MM-dd HH:mm');
  const snoozeTitle = isSnoozedColumn ? 'Unsnooze' : 'Snooze';
  return `<div class="pr-card" data-key="${escapeHtml(key)}" data-url="${escapeHtml(pr.url)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(pr.title)} on ${escapeHtml(pr.repo.label)}">
<div class="pr-card-repo">${escapeHtml(pr.repo.label)}</div>
<div class="pr-card-title">${escapeHtml(pr.title)}</div>
<div class="pr-card-meta">${AUTHOR_ICON}<span>${escapeHtml(pr.authorLogin)}</span><span class="pr-card-age" title="${escapeHtml(absolute)}">${escapeHtml(age)}</span></div>
<button class="pr-card-snooze icon-btn" type="button" data-key="${escapeHtml(key)}" title="${snoozeTitle}" aria-label="${snoozeTitle} ${escapeHtml(pr.title)}">${SNOOZE_ICON}</button>
</div>`;
}

function renderColumn(bucket: LaunchpadBucket, items: CategorizedPullRequest[], now: Date): string {
  const body =
    items.length === 0
      ? '<p class="column-empty">Nothing here.</p>'
      : items.map((item) => renderCard(item.pr, now, bucket === 'snoozed')).join('\n');
  return `<div class="column" data-bucket="${bucket}">
<div class="column-head"><span class="column-title">${BUCKET_LABELS[bucket]}</span><span class="badge">${items.length}</span></div>
<div class="column-body">${body}</div>
</div>`;
}

/** Builds Launchpad's full HTML document — a 6-column board of PRs pooled across every recognized repo in the workspace. Pure — nonce/cspSource/styleUris come from the caller, so this is unit-testable without a real webview host. */
export function renderLaunchpadHtml(data: LaunchpadData, opts: RenderLaunchpadOptions): string {
  const now = data.now ?? new Date();
  const styles = opts.styleUris.map((uri) => `<link rel="stylesheet" href="${uri}" />`).join('\n');

  const byBucket = new Map<LaunchpadBucket, CategorizedPullRequest[]>(LAUNCHPAD_BUCKETS.map((b) => [b, []]));
  for (const item of data.categorized) {
    byBucket.get(item.bucket)?.push(item);
  }
  const columns = LAUNCHPAD_BUCKETS.map((bucket) => renderColumn(bucket, byBucket.get(bucket) ?? [], now)).join('\n');

  const errors =
    data.errors.length === 0
      ? ''
      : `<div class="errors">${data.errors
          .map((e) => `<p class="error-row">${escapeHtml(e.repo.label)}: ${escapeHtml(e.message)}</p>`)
          .join('\n')}</div>`;

  const empty = data.categorized.length === 0 && data.errors.length === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src https: ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
${styles}
<title>GitLore Launchpad</title>
</head>
<body>
<div class="toolbar">
<span class="title">Launchpad</span>
<span class="spacer"></span>
<button id="refresh" class="icon-btn" type="button" title="Refresh" aria-label="Refresh Launchpad">${REFRESH_ICON}</button>
</div>
${errors}
${empty ? '<p class="empty">No pull requests need your attention right now.</p>' : `<div class="board">${columns}</div>`}
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();

for (const card of document.querySelectorAll('.pr-card')) {
  const open = () => vscode.postMessage({ type: 'openPr', url: card.dataset.url });
  card.addEventListener('click', (e) => {
    if (e.target.closest('.pr-card-snooze')) return;
    open();
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
}

for (const btn of document.querySelectorAll('.pr-card-snooze')) {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    vscode.postMessage({ type: 'toggleSnooze', key: btn.dataset.key });
  });
}

document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});
</script>
</body>
</html>`;
}
