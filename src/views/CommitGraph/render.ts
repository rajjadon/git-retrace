import type { GraphNode } from '../../core/graph/layout';
import type { BranchInfo, Ref, WorkingChanges } from '../../core/git/types';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { buildGravatarUrl } from '../../utils/gravatar';
import {
  BRANCH_ICON,
  FILE_COUNT_ICON,
  PENDING_ICON,
  REFRESH_ICON,
  REMOTE_ICON,
  SEARCH_ICON,
  TAG_ICON,
} from '../icons';

export interface RenderGraphOptions {
  nonce: string;
  cspSource: string;
  styleUri: string;
}

export interface GraphData {
  nodes: GraphNode[];
  /** Every local and remote branch, for the toolbar's ref picker. */
  branches?: BranchInfo[];
  /** The ref the graph is currently scoped to — empty string means "all branches". */
  currentRef?: string;
  /** Uncommitted work, rendered as a pinned row above the newest commit when non-empty. */
  workingChanges?: WorkingChanges;
  /** Row to mark selected on load, so a refresh doesn't lose the user's place. */
  selectedSha?: string;
  now?: Date;
}

const ROW_HEIGHT = 24;
const LANE_WIDTH = 18;
const AVATAR_RADIUS = 6;
// One label, not two. At the panel's real width two labels plus the overflow badge shared ~132px
// and both truncated to noise ("m…", "origi…"). The `+N` badge's tooltip still names the rest.
const MAX_VISIBLE_REFS = 1;

// VS Code's own categorical palette (Settings UI, extension charts) — theme-aware for free,
// unlike a hardcoded hex list that could clash on a light theme or a high-contrast theme.
const LANE_COLOR_VARS = [
  '--vscode-charts-blue',
  '--vscode-charts-orange',
  '--vscode-charts-green',
  '--vscode-charts-purple',
  '--vscode-charts-red',
  '--vscode-charts-yellow',
  '--vscode-charts-foreground',
];

function laneColor(lane: number): string {
  const name = LANE_COLOR_VARS[lane % LANE_COLOR_VARS.length] ?? LANE_COLOR_VARS[0] ?? '--vscode-charts-foreground';
  return `var(${name})`;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** A straight line within one lane, or a smooth S-curve when the segment changes lanes — the sharp diagonals of a plain `<line>` are what made a busy merge area look cramped next to GitLens's curved graph. */
function svgSegment(x1: number, y1: number, x2: number, y2: number, color: string): string {
  if (x1 === x2) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-linecap="round" />`;
  }
  const midY = (y1 + y2) / 2;
  return `<path d="M${x1} ${y1} C${x1} ${midY} ${x2} ${midY} ${x2} ${y2}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" />`;
}

/** Builds one row's graph cell: a small SVG scoped to that row alone (local y: 0 top, ROW_HEIGHT bottom), in normal flex/grid flow next to the row's text — not one giant absolutely-positioned SVG behind a separately-flowing text column. The commit's own avatar sits clipped into a circle at the node position (like GitLens), ringed in the lane color, instead of a plain dot. */
function renderRowGraphics(node: GraphNode, svgWidth: number, avatarUrl: string): string {
  const top = 0;
  const center = ROW_HEIGHT / 2;
  const bottom = ROW_HEIGHT;
  const parts: string[] = [];

  // Pass-through lines: lanes untouched by this commit, still active before and after it.
  node.lanesBefore.forEach((sha, lane) => {
    if (sha !== null && sha === node.lanesAfter[lane] && lane !== node.lane) {
      parts.push(svgSegment(laneX(lane), top, laneX(lane), bottom, laneColor(lane)));
    }
  });

  // Incoming merges: a branch converging into this commit's lane, folding in from the row above.
  for (const mergeLane of node.incomingMergeLanes) {
    parts.push(svgSegment(laneX(mergeLane), top, laneX(node.lane), center, laneColor(mergeLane)));
  }

  // Outgoing edges: straight continuation, or a fan-out curve for a merge commit's extra parents.
  for (const parentLane of node.parentLanes) {
    parts.push(svgSegment(laneX(node.lane), center, laneX(parentLane), bottom, laneColor(node.lane)));
  }

  const cx = laneX(node.lane);
  const cy = center;
  // git SHAs are pure hex — safe to use verbatim as an id, no escaping needed, and unique enough
  // that concatenating every row's SVG into one document never collides clip-path references.
  const clipId = `avatarClip-${node.commit.sha}`;
  parts.push(`<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${AVATAR_RADIUS}" /></clipPath>`);
  parts.push(
    `<image href="${avatarUrl}" x="${cx - AVATAR_RADIUS}" y="${cy - AVATAR_RADIUS}" width="${AVATAR_RADIUS * 2}" height="${AVATAR_RADIUS * 2}" clip-path="url(#${clipId})" />`,
  );
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${AVATAR_RADIUS}" fill="none" stroke="${laneColor(node.lane)}" stroke-width="1.5" />`);

  return `<svg class="graph-row-svg" width="${svgWidth}" height="${ROW_HEIGHT}" aria-hidden="true">${parts.join('')}</svg>`;
}

/** The pending-changes row's stub: a dashed node in lane 0 with the trunk continuing downward into the newest commit. */
function renderPendingGraphics(svgWidth: number): string {
  const cx = laneX(0);
  const cy = ROW_HEIGHT / 2;
  return `<svg class="graph-row-svg" width="${svgWidth}" height="${ROW_HEIGHT}" aria-hidden="true">${svgSegment(cx, cy, cx, ROW_HEIGHT, laneColor(0))}<circle cx="${cx}" cy="${cy}" r="${AVATAR_RADIUS}" fill="var(--vscode-editor-background)" stroke="${laneColor(0)}" stroke-width="1.5" stroke-dasharray="2 1.6" /></svg>`;
}

const REF_ICONS: Record<Ref['type'], string> = {
  branch: BRANCH_ICON,
  remoteBranch: REMOTE_ICON,
  tag: TAG_ICON,
  detached: BRANCH_ICON,
};

/**
 * Sort weight deciding which refs survive the `MAX_VISIBLE_REFS` cap. The checked-out branch is
 * the one label a reader is actually looking for, so it always wins; remote-tracking refs lose,
 * since on a synced repo they only restate the local branch immediately above them.
 */
function refRank(ref: Ref): number {
  if (ref.isHead) {
    return 0;
  }
  return { branch: 1, tag: 2, remoteBranch: 3, detached: 1 }[ref.type];
}

function renderRef(ref: Ref): string {
  const headClass = ref.isHead ? ' ref-head' : '';
  const title = ref.isHead ? `${ref.name} (current)` : ref.name;
  return `<span class="ref ref-${ref.type}${headClass}" title="${escapeHtml(title)}">${REF_ICONS[ref.type]}<span class="ref-name">${escapeHtml(ref.name)}</span></span>`;
}

/** Caps visible labels so one heavily-tagged commit can't stretch the shared column width for every row. */
function renderRefs(refs: Ref[]): string {
  if (refs.length === 0) {
    return '';
  }
  const ordered = [...refs].sort((a, b) => refRank(a) - refRank(b));
  const visible = ordered.slice(0, MAX_VISIBLE_REFS).map(renderRef).join('');
  const hidden = ordered.slice(MAX_VISIBLE_REFS);
  if (hidden.length === 0) {
    return visible;
  }
  const title = escapeHtml(hidden.map((r) => r.name).join(', '));
  return `${visible}<span class="ref ref-more" title="${title}">+${hidden.length}</span>`;
}

function maxLane(nodes: GraphNode[]): number {
  let max = 0;
  for (const node of nodes) {
    max = Math.max(max, node.lane, ...node.parentLanes, ...node.incomingMergeLanes);
  }
  return max;
}

function renderRefPicker(branches: BranchInfo[], currentRef: string): string {
  const option = (value: string, label: string): string =>
    `<option value="${escapeHtml(value)}"${value === currentRef ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote);
  const group = (label: string, items: BranchInfo[]): string =>
    items.length === 0
      ? ''
      : `<optgroup label="${label}">${items.map((b) => option(b.name, b.isCurrent ? `${b.name} (current)` : b.name)).join('')}</optgroup>`;

  return `<span class="ref-picker">${BRANCH_ICON}<select id="ref-filter" aria-label="Scope the graph to a branch">${option('', 'All branches')}${group('Local', local)}${group('Remote', remote)}</select></span>`;
}

/** GitLens's `+added ~modified -deleted` badge — counted by file, so the three numbers sum to the file count. */
function renderWorkingChangeBadges(changes: WorkingChanges): string {
  const parts: string[] = [];
  if (changes.added > 0) {
    parts.push(`<span class="stat-add" title="${changes.added} added">+${changes.added}</span>`);
  }
  if (changes.modified > 0) {
    parts.push(`<span class="stat-mod" title="${changes.modified} modified">~${changes.modified}</span>`);
  }
  if (changes.deleted > 0) {
    parts.push(`<span class="stat-del" title="${changes.deleted} deleted">&minus;${changes.deleted}</span>`);
  }
  return parts.join('');
}

function renderWorkingChangesRow(changes: WorkingChanges, svgWidth: number, tabbable: boolean): string {
  const label = `${changes.total} uncommitted ${changes.total === 1 ? 'file' : 'files'}`;
  return `<div class="row wip" role="row" tabindex="${tabbable ? '0' : '-1'}" aria-selected="false" data-wip="1" data-filter="working changes uncommitted" aria-label="Working changes — ${escapeHtml(label)}. Open the Source Control view.">
<span class="cell cell-refs" role="gridcell"><span class="ref ref-pending">${PENDING_ICON}<span class="ref-name">Working Changes</span></span></span>
<span class="cell cell-graph" role="gridcell">${renderPendingGraphics(svgWidth)}</span>
<span class="cell cell-message" role="gridcell">Uncommitted changes</span>
<span class="cell cell-author" role="gridcell"></span>
<span class="cell cell-changes" role="gridcell" title="${escapeHtml(label)}">${renderWorkingChangeBadges(changes)}</span>
<span class="cell cell-date" role="gridcell"></span>
<span class="cell cell-sha" role="gridcell"></span>
</div>`;
}

/** Builds the commit graph webview's full HTML document. Pure — nonce/cspSource/styleUri come from the caller, so this is unit-testable without a real webview host. */
export function renderGraphHtml(data: GraphData, opts: RenderGraphOptions): string {
  const { nodes, branches = [], currentRef = '', workingChanges, selectedSha } = data;
  const now = data.now ?? new Date();
  // A little extra room beyond the widest lane so the dot never sits flush against the text
  // column — the bug that made a single-branch (one-lane) graph look like it was overlapping.
  const svgWidth = (maxLane(nodes) + 1) * LANE_WIDTH + LANE_WIDTH / 2;
  const hasWip = workingChanges !== undefined && workingChanges.total > 0;
  // Roving tabindex: exactly one row is tab-reachable and the script moves it with the selection —
  // 200 individually tabbable rows would otherwise trap keyboard users inside the graph. The stop
  // goes to the selected row if it's still in this result set (a ref filter can drop it), else to
  // the topmost row, which is the working-changes row whenever the tree is dirty.
  const selectedNode = selectedSha === undefined ? undefined : nodes.find((n) => n.commit.sha === selectedSha);
  const wipTabbable = hasWip && selectedNode === undefined;
  const tabStopSha = selectedNode?.commit.sha ?? (wipTabbable ? undefined : nodes[0]?.commit.sha);

  const rows = nodes
    .map((node) => {
      const { commit } = node;
      const date = new Date(commit.date);
      const age = formatAge(date, now);
      const absolute = formatAbsolute(date, 'yyyy-MM-dd HH:mm');
      const avatarUrl = buildGravatarUrl(commit.authorEmail, { size: AVATAR_RADIUS * 4 });
      const isSelected = selectedNode?.commit.sha === commit.sha;
      // Merge commits report 0 files (git emits no numstat for them) — say so rather than
      // showing a bare "0" that reads like the commit changed nothing.
      const statTitle =
        commit.filesChanged === 0
          ? 'No per-file stat (merge commit)'
          : `${commit.filesChanged} files, +${commit.insertions} −${commit.deletions}`;
      // Lowercased haystack for the toolbar filter — cheaper than re-reading each row's text.
      const filter = `${commit.message} ${commit.author} ${commit.sha}`.toLowerCase();
      return `<div class="row commit${isSelected ? ' selected' : ''}" role="row" tabindex="${commit.sha === tabStopSha ? '0' : '-1'}" aria-selected="${isSelected}" data-sha="${escapeHtml(commit.sha)}" data-filter="${escapeHtml(filter)}">
<span class="cell cell-refs" role="gridcell">${renderRefs(commit.refs)}</span>
<span class="cell cell-graph" role="gridcell">${renderRowGraphics(node, svgWidth, avatarUrl)}</span>
<span class="cell cell-message" role="gridcell" title="${escapeHtml(commit.message)}">${escapeHtml(commit.message)}</span>
<span class="cell cell-author" role="gridcell">${escapeHtml(commit.author)}</span>
<span class="cell cell-changes" role="gridcell" title="${escapeHtml(statTitle)}">${FILE_COUNT_ICON}<span class="file-count">${commit.filesChanged}</span></span>
<span class="cell cell-date" role="gridcell" title="${escapeHtml(absolute)}">${escapeHtml(age)}</span>
<span class="cell cell-sha" role="gridcell"><code>${escapeHtml(commit.shortSha)}</code></span>
</div>`;
    })
    .join('\n');

  const empty = nodes.length === 0 && !hasWip;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src https: ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
<link rel="stylesheet" href="${opts.styleUri}" />
<style nonce="${opts.nonce}">:root { --graph-svg-width: ${svgWidth}px; --graph-row-height: ${ROW_HEIGHT}px; }</style>
<title>Commit Graph</title>
</head>
<body>
<div class="toolbar">
${renderRefPicker(branches, currentRef)}
<span class="search">${SEARCH_ICON}<input id="search" type="search" placeholder="Filter by message, author, or SHA" aria-label="Filter commits by message, author, or SHA" autocomplete="off" spellcheck="false" /></span>
<span class="count" id="count" aria-live="polite">${nodes.length} ${nodes.length === 1 ? 'commit' : 'commits'}</span>
<button id="refresh" class="icon-btn" type="button" title="Refresh" aria-label="Refresh the commit graph">${REFRESH_ICON}</button>
</div>
<div class="grid" role="grid" aria-label="Commit graph" aria-rowcount="${nodes.length + (hasWip ? 1 : 0)}">
<div class="row header" role="row">
<span class="cell" role="columnheader">Branch / Tag</span>
<span class="cell" role="columnheader">Graph</span>
<span class="cell" role="columnheader">Commit Message</span>
<span class="cell" role="columnheader">Author</span>
<span class="cell" role="columnheader">Changes</span>
<span class="cell" role="columnheader">Commit Date</span>
<span class="cell" role="columnheader">SHA</span>
</div>
<div class="rows" id="rows">
${hasWip ? renderWorkingChangesRow(workingChanges, svgWidth, wipTabbable) : ''}
${rows}
</div>
${empty ? '<p class="empty">No commits yet.</p>' : ''}
</div>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
const rowsEl = document.getElementById('rows');
const countEl = document.getElementById('count');
const searchEl = document.getElementById('search');
const allRows = Array.from(rowsEl.querySelectorAll('.row'));

function visibleRows() {
  return allRows.filter((r) => !r.hidden);
}

function select(row, { open = true } = {}) {
  if (!row) return;
  for (const other of allRows) {
    const isTarget = other === row;
    other.classList.toggle('selected', isTarget);
    other.setAttribute('aria-selected', String(isTarget));
    other.tabIndex = isTarget ? 0 : -1;
  }
  row.focus();
  if (!open) return;
  if (row.dataset.wip) vscode.postMessage({ type: 'openWorkingChanges' });
  else vscode.postMessage({ type: 'openCommit', sha: row.dataset.sha });
}

for (const row of allRows) {
  row.addEventListener('click', () => select(row));
}

rowsEl.addEventListener('keydown', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    select(row);
    return;
  }
  const shown = visibleRows();
  const i = shown.indexOf(row);
  let next = null;
  if (e.key === 'ArrowDown') next = shown[i + 1];
  else if (e.key === 'ArrowUp') next = shown[i - 1];
  else if (e.key === 'Home') next = shown[0];
  else if (e.key === 'End') next = shown[shown.length - 1];
  else return;
  e.preventDefault();
  // Move focus without loading a commit on every keystroke — Enter commits to the selection.
  if (next) select(next, { open: false });
});

searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim().toLowerCase();
  let shown = 0;
  for (const row of allRows) {
    const match = q === '' || row.dataset.filter.includes(q);
    row.hidden = !match;
    if (match && row.dataset.sha) shown += 1;
  }
  countEl.textContent = q === ''
    ? shown + (shown === 1 ? ' commit' : ' commits')
    : shown + ' of ' + ${nodes.length} + ' commits';
});

document.getElementById('ref-filter').addEventListener('change', (e) => {
  vscode.postMessage({ type: 'setRef', ref: e.target.value });
});

document.getElementById('refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});
</script>
</body>
</html>`;
}
