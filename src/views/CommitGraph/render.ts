import type { GraphNode } from '../../core/graph/layout';
import type { Ref } from '../../core/git/types';
import { formatAge } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';

export interface RenderGraphOptions {
  nonce: string;
  cspSource: string;
  styleUri: string;
}

export interface GraphData {
  nodes: GraphNode[];
  now?: Date;
}

const ROW_HEIGHT = 28;
const LANE_WIDTH = 16;
const DOT_RADIUS = 4;
const LANE_COLORS = ['#4daafc', '#e2a336', '#3fb950', '#f778ba', '#a371f7', '#ff7b72', '#39c5cf'];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? LANE_COLORS[0] ?? '#4daafc';
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function rowTop(row: number): number {
  return row * ROW_HEIGHT;
}

function rowCenter(row: number): number {
  return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function rowBottom(row: number): number {
  return (row + 1) * ROW_HEIGHT;
}

function svgLine(x1: number, y1: number, x2: number, y2: number, color: string): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" />`;
}

function renderRowGraphics(node: GraphNode, row: number): string {
  const parts: string[] = [];

  // Pass-through lines: lanes untouched by this commit, still active before and after it.
  node.lanesBefore.forEach((sha, lane) => {
    if (sha !== null && sha === node.lanesAfter[lane] && lane !== node.lane) {
      parts.push(svgLine(laneX(lane), rowTop(row), laneX(lane), rowBottom(row), laneColor(lane)));
    }
  });

  // Incoming merges: a branch converging into this commit's lane, folding in from the row above.
  for (const mergeLane of node.incomingMergeLanes) {
    parts.push(svgLine(laneX(mergeLane), rowTop(row), laneX(node.lane), rowCenter(row), laneColor(mergeLane)));
  }

  // Outgoing edges: straight continuation, or a fan-out diagonal for a merge commit's extra parents.
  for (const parentLane of node.parentLanes) {
    parts.push(svgLine(laneX(node.lane), rowCenter(row), laneX(parentLane), rowBottom(row), laneColor(node.lane)));
  }

  parts.push(
    `<circle cx="${laneX(node.lane)}" cy="${rowCenter(row)}" r="${DOT_RADIUS}" fill="${laneColor(node.lane)}" />`,
  );

  return parts.join('');
}

function renderRefBadge(ref: Ref): string {
  const typeClass = { branch: 'ref-branch', tag: 'ref-tag', detached: 'ref-detached' }[ref.type];
  return `<span class="ref-badge ${typeClass}">${escapeHtml(ref.name)}</span>`;
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
  const svgWidth = (maxLane(nodes) + 1) * LANE_WIDTH;
  const svgHeight = nodes.length * ROW_HEIGHT;

  const graphics = nodes.map((node, row) => renderRowGraphics(node, row)).join('');

  const rows = nodes
    .map((node) => {
      const { commit } = node;
      const age = formatAge(new Date(commit.date), now);
      const refs = commit.refs.map(renderRefBadge).join('');
      return `<div class="graph-row" style="height:${ROW_HEIGHT}px" data-sha="${escapeHtml(commit.sha)}" tabindex="0" role="button" aria-label="Show commit details for ${escapeHtml(commit.message)}">
<span class="graph-message">${escapeHtml(commit.message)}</span>
${refs}
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
<link rel="stylesheet" href="${opts.styleUri}" />
<title>Commit Graph</title>
</head>
<body>
<h1>Commit Graph</h1>
<div class="graph">
<svg class="graph-svg" width="${svgWidth}" height="${svgHeight}" aria-hidden="true">${graphics}</svg>
<div class="graph-rows" style="margin-left:${svgWidth}px">
${rows}
</div>
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
