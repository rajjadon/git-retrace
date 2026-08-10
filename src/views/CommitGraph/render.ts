import type { GraphNode } from '../../core/graph/layout';
import type { Ref } from '../../core/git/types';
import { formatAge } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { buildGravatarUrl } from '../../utils/gravatar';

export interface RenderGraphOptions {
  nonce: string;
  cspSource: string;
  styleUri: string;
}

export interface GraphData {
  nodes: GraphNode[];
  now?: Date;
}

const ROW_HEIGHT = 22;
const LANE_WIDTH = 16;
const DOT_RADIUS = 4;
const MAX_VISIBLE_REFS = 2;

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

function svgLine(x1: number, y1: number, x2: number, y2: number, color: string): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-linecap="round" />`;
}

/** Builds one row's graph cell: a small SVG scoped to that row alone (local y: 0 top, ROW_HEIGHT bottom), in normal flex/grid flow next to the row's text — not one giant absolutely-positioned SVG behind a separately-flowing text column. */
function renderRowGraphics(node: GraphNode, svgWidth: number): string {
  const top = 0;
  const center = ROW_HEIGHT / 2;
  const bottom = ROW_HEIGHT;
  const parts: string[] = [];

  // Pass-through lines: lanes untouched by this commit, still active before and after it.
  node.lanesBefore.forEach((sha, lane) => {
    if (sha !== null && sha === node.lanesAfter[lane] && lane !== node.lane) {
      parts.push(svgLine(laneX(lane), top, laneX(lane), bottom, laneColor(lane)));
    }
  });

  // Incoming merges: a branch converging into this commit's lane, folding in from the row above.
  for (const mergeLane of node.incomingMergeLanes) {
    parts.push(svgLine(laneX(mergeLane), top, laneX(node.lane), center, laneColor(mergeLane)));
  }

  // Outgoing edges: straight continuation, or a fan-out diagonal for a merge commit's extra parents.
  for (const parentLane of node.parentLanes) {
    parts.push(svgLine(laneX(node.lane), center, laneX(parentLane), bottom, laneColor(node.lane)));
  }

  parts.push(`<circle cx="${laneX(node.lane)}" cy="${center}" r="${DOT_RADIUS}" fill="${laneColor(node.lane)}" />`);

  return `<svg class="graph-row-svg" width="${svgWidth}" height="${ROW_HEIGHT}" aria-hidden="true">${parts.join('')}</svg>`;
}

function renderRefBadge(ref: Ref): string {
  const typeClass = { branch: 'ref-branch', tag: 'ref-tag', detached: 'ref-detached' }[ref.type];
  return `<span class="ref-badge ${typeClass}">${escapeHtml(ref.name)}</span>`;
}

/** Caps visible badges so one heavily-tagged commit can't stretch the shared column width for every row. */
function renderRefs(refs: Ref[]): string {
  if (refs.length === 0) {
    return '';
  }
  const visible = refs.slice(0, MAX_VISIBLE_REFS).map(renderRefBadge).join('');
  const hidden = refs.slice(MAX_VISIBLE_REFS);
  if (hidden.length === 0) {
    return visible;
  }
  const title = escapeHtml(hidden.map((r) => r.name).join(', '));
  return `${visible}<span class="ref-badge ref-more" title="${title}">+${hidden.length}</span>`;
}

function maxLane(nodes: GraphNode[]): number {
  let max = 0;
  for (const node of nodes) {
    max = Math.max(max, node.lane, ...node.parentLanes, ...node.incomingMergeLanes);
  }
  return max;
}

/** Builds the commit graph webview's full HTML document. Pure — nonce/cspSource/styleUri come from the caller, so this is unit-testable without a real webview host. */
export function renderGraphHtml(data: GraphData, opts: RenderGraphOptions): string {
  const { nodes } = data;
  const now = data.now ?? new Date();
  // A little extra room beyond the widest lane so the dot never sits flush against the text
  // column — the bug that made a single-branch (one-lane) graph look like it was overlapping.
  const svgWidth = (maxLane(nodes) + 1) * LANE_WIDTH + LANE_WIDTH / 2;

  const rows = nodes
    .map((node) => {
      const { commit } = node;
      const age = formatAge(new Date(commit.date), now);
      const avatarUrl = buildGravatarUrl(commit.authorEmail, { size: 32 });
      return `<div class="graph-row" data-sha="${escapeHtml(commit.sha)}" tabindex="0" role="button" aria-label="Show commit details for ${escapeHtml(commit.message)}">
${renderRowGraphics(node, svgWidth)}
<img class="graph-avatar" src="${avatarUrl}" alt="" width="16" height="16" />
<span class="graph-message">${escapeHtml(commit.message)}</span>
<span class="graph-refs">${renderRefs(commit.refs)}</span>
<span class="graph-author">${escapeHtml(commit.author)}</span>
<span class="graph-age">${escapeHtml(age)}</span>
<span class="graph-sha"><code>${escapeHtml(commit.shortSha)}</code></span>
</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource}; img-src https: ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
<link rel="stylesheet" href="${opts.styleUri}" />
<title>Commit Graph</title>
</head>
<body>
<h1>Commit Graph</h1>
<div class="graph" style="--graph-svg-width:${svgWidth}px; --graph-row-height:${ROW_HEIGHT}px">
${rows}
</div>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
function openRow(row) {
  const sha = row.getAttribute('data-sha');
  if (sha) vscode.postMessage({ type: 'openCommit', sha });
}
for (const row of document.querySelectorAll('.graph-row')) {
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
