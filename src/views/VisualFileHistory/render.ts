import type { FileHistoryPoint } from '../../core/graph/fileHistoryLayout';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { buildGravatarUrl } from '../../utils/gravatar';
import { chartCssVarForIndex } from '../../utils/colors';

export interface RenderFileHistoryOptions {
  nonce: string;
  cspSource: string;
  /** Stylesheets to link, in order. Shared rules first, then the panel's own — same convention as Commit Graph. */
  styleUris: string[];
}

export interface FileHistoryData {
  points: FileHistoryPoint[];
  now?: Date;
}

const LANE_HEIGHT = 90;
const LANE_LABEL_WIDTH = 120;
const CHART_WIDTH = 1100;
const AXIS_HEIGHT = 36;
const BAR_BAND_HEIGHT = 160;
const MIN_RADIUS = 9;
const MAX_RADIUS = 26;
const PADDING_X = 24;
/** Minimum pixel gap between two axis labels — spacing by index alone still lets a tight burst of commits (a rebase/squash session) place two labels close enough to overlap. */
const MIN_AXIS_LABEL_GAP_PX = 70;
/** A one-line change scaled by magnitude alone can round to a sub-pixel sliver — this floor keeps every non-zero bar actually visible. */
const MIN_BAR_HEIGHT = 4;
const BAR_WIDTH = 8;
/** Vertical nudge per collision tier, and the cap on how far a bubble can be pushed — kept under `LANE_HEIGHT / 2` so a jittered bubble never bleeds into the neighboring lane. */
const JITTER_STEP = 16;
const MAX_JITTER = 32;

function xFor(t: number): number {
  return PADDING_X + t * (CHART_WIDTH - 2 * PADDING_X);
}

function laneY(lane: number): number {
  return lane * LANE_HEIGHT + LANE_HEIGHT / 2;
}

/** One label per lane, using the most recent point's author name seen for that lane (a lane's author can only change display name, never identity — grouped by email in `layoutFileHistory`). */
function laneLabels(points: FileHistoryPoint[]): Map<number, string> {
  const labels = new Map<number, string>();
  // `points` is newest-first, so the first point seen per lane is that lane's most recent name.
  for (const point of points) {
    if (!labels.has(point.lane)) {
      labels.set(point.lane, point.entry.author);
    }
  }
  return labels;
}

/**
 * Picks which points get an axis label by walking left to right and greedily keeping one whenever
 * it's at least `MIN_AXIS_LABEL_GAP_PX` past the last label placed. Spacing by actual pixel
 * position (not by index) is what guarantees no overlap — a burst of commits close together in
 * time still only contributes one label, however many commits land inside that burst.
 */
function pickAxisLabelIndices(points: FileHistoryPoint[]): Set<number> {
  const order = points.map((point, i) => ({ i, x: xFor(point.t) })).sort((a, b) => a.x - b.x);
  const indices = new Set<number>();
  let lastX: number | undefined;
  for (const { i, x } of order) {
    if (lastX === undefined || x - lastX >= MIN_AXIS_LABEL_GAP_PX) {
      indices.add(i);
      lastX = x;
    }
  }
  return indices;
}

function radiusFor(point: FileHistoryPoint): number {
  return MIN_RADIUS + point.magnitude * (MAX_RADIUS - MIN_RADIUS);
}

/**
 * Commits close together in time on the same author lane land at nearly the same x — left alone,
 * their circles fully overlap into an unreadable blob (real-world repos with rebase/squash bursts
 * hit this constantly). Walking each lane in x-order and nudging a colliding point alternately
 * up/down, with the nudge growing every consecutive collision, turns a stacked blob into a small
 * readable cluster instead. Keyed by sha, since points don't otherwise carry a stable index.
 */
function computeCollisionOffsets(points: FileHistoryPoint[]): Map<string, number> {
  const byLane = new Map<number, FileHistoryPoint[]>();
  for (const point of points) {
    const list = byLane.get(point.lane) ?? [];
    list.push(point);
    byLane.set(point.lane, list);
  }

  const offsets = new Map<string, number>();
  for (const lanePoints of byLane.values()) {
    const sorted = [...lanePoints].sort((a, b) => a.t - b.t);
    let lastX: number | undefined;
    let lastR = 0;
    let tier = 0;
    for (const point of sorted) {
      const x = xFor(point.t);
      const r = radiusFor(point);
      const collides = lastX !== undefined && Math.abs(x - lastX) < lastR + r;
      tier = collides ? tier + 1 : 0;
      const sign = tier % 2 === 1 ? 1 : -1;
      const magnitude = Math.min(Math.ceil(tier / 2) * JITTER_STEP, MAX_JITTER);
      offsets.set(point.entry.sha, tier === 0 ? 0 : sign * magnitude);
      lastX = x;
      lastR = r;
    }
  }
  return offsets;
}

/**
 * A flat, author-colored circle — not an avatar photo. At the density this chart runs at (every
 * commit gets a bubble, often dozens visible at once) a clipped photo per bubble reads as noise;
 * one solid color per lane is what actually stays legible, and matches lane identity to the lane
 * label text above it. The avatar photo still appears once, in the hover tooltip, where there's
 * room for it to mean something.
 */
function renderBubble(point: FileHistoryPoint, now: Date, yOffset: number): string {
  const { entry } = point;
  const cx = xFor(point.t);
  const cy = laneY(point.lane) + yOffset;
  const r = radiusFor(point);
  const avatarUrl = buildGravatarUrl(entry.authorEmail, { size: 32 });
  const age = formatAge(new Date(entry.date), now);
  const absolute = formatAbsolute(new Date(entry.date), 'yyyy-MM-dd HH:mm');

  return `<g class="fh-point" tabindex="0" role="button" data-sha="${escapeHtml(entry.sha)}" data-author="${escapeHtml(entry.author)}" data-message="${escapeHtml(entry.message)}" data-age="${escapeHtml(age)}" data-absolute="${escapeHtml(absolute)}" data-avatar="${escapeHtml(avatarUrl)}" data-insertions="${entry.insertions}" data-deletions="${entry.deletions}" aria-label="${escapeHtml(entry.message)} by ${escapeHtml(entry.author)}, ${age}">
<circle class="fh-bubble" cx="${cx}" cy="${cy}" r="${r}" fill="${chartCssVarForIndex(point.lane)}" />
</g>`;
}

/** Additions above the baseline, deletions below — same visual grammar as a stacked +/- diffstat, scaled by this point's own magnitude relative to the dataset. A floor keeps a one-line change from rendering as a sliver too thin to see. */
function renderChangeBar(point: FileHistoryPoint, baselineY: number): string {
  const { entry } = point;
  const total = entry.insertions + entry.deletions;
  if (total === 0) {
    return '';
  }
  const x = xFor(point.t);
  const maxBarHeight = (BAR_BAND_HEIGHT / 2) * point.magnitude;
  const addHeight = entry.insertions > 0 ? Math.max((entry.insertions / total) * maxBarHeight, MIN_BAR_HEIGHT) : 0;
  const delHeight = entry.deletions > 0 ? Math.max((entry.deletions / total) * maxBarHeight, MIN_BAR_HEIGHT) : 0;
  return `<rect x="${x - BAR_WIDTH / 2}" y="${baselineY - addHeight}" width="${BAR_WIDTH}" height="${addHeight}" rx="1.5" fill="var(--vscode-gitDecoration-addedResourceForeground)" />
<rect x="${x - BAR_WIDTH / 2}" y="${baselineY}" width="${BAR_WIDTH}" height="${delHeight}" rx="1.5" fill="var(--vscode-gitDecoration-deletedResourceForeground)" />`;
}

function renderAxisLabels(points: FileHistoryPoint[], now: Date, axisY: number): string {
  const indices = pickAxisLabelIndices(points);
  return points
    .map((point, i) => {
      if (!indices.has(i)) {
        return '';
      }
      const x = xFor(point.t);
      const age = formatAge(new Date(point.entry.date), now);
      return `<text class="fh-axis-label" x="${x}" y="${axisY}" text-anchor="middle">${escapeHtml(age)}</text>`;
    })
    .join('');
}

/** Builds the Visual File History webview's full HTML document. Pure — unit-testable without a real webview host, same convention as `renderGraphHtml`. */
export function renderFileHistoryHtml(data: FileHistoryData, opts: RenderFileHistoryOptions): string {
  const { points } = data;
  const now = data.now ?? new Date();
  const styles = opts.styleUris.map((uri) => `<link rel="stylesheet" href="${uri}" />`).join('\n');

  if (points.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}';" />
${styles}
<title>Visual File History</title>
</head>
<body>
<p class="empty">No history yet.</p>
</body>
</html>`;
  }

  const maxLane = Math.max(...points.map((p) => p.lane));
  const lanesHeight = (maxLane + 1) * LANE_HEIGHT;
  const barsY = lanesHeight + BAR_BAND_HEIGHT / 2;
  const axisY = lanesHeight + BAR_BAND_HEIGHT + AXIS_HEIGHT - 8;
  const svgHeight = lanesHeight + BAR_BAND_HEIGHT + AXIS_HEIGHT;
  const labels = laneLabels(points);

  const laneRows = Array.from(labels.entries())
    .map(
      ([lane, author]) =>
        `<line class="fh-lane-guide" x1="0" y1="${laneY(lane)}" x2="${CHART_WIDTH}" y2="${laneY(lane)}" />
<text class="fh-lane-label" x="-${LANE_LABEL_WIDTH - 12}" y="${laneY(lane)}" dominant-baseline="middle">${escapeHtml(author)}</text>`,
    )
    .join('');

  const collisionOffsets = computeCollisionOffsets(points);
  const bubbles = points.map((p) => renderBubble(p, now, collisionOffsets.get(p.entry.sha) ?? 0)).join('\n');
  const bars = points.map((p) => renderChangeBar(p, barsY)).join('\n');
  const axisLabels = renderAxisLabels(points, now, axisY);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src https: ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
${styles}
<title>Visual File History</title>
</head>
<body>
<div class="fh-legend">
<span class="fh-legend-item"><span class="fh-legend-swatch fh-legend-add"></span>Additions</span>
<span class="fh-legend-item"><span class="fh-legend-swatch fh-legend-del"></span>Deletions</span>
<span class="fh-legend-hint">Bubble size = lines changed · lane = author</span>
</div>
<div class="fh-scroll">
<svg class="fh-chart" viewBox="-${LANE_LABEL_WIDTH} 0 ${CHART_WIDTH + LANE_LABEL_WIDTH} ${svgHeight}" width="${CHART_WIDTH + LANE_LABEL_WIDTH}" height="${svgHeight}">
<line class="fh-axis-line" x1="0" y1="0" x2="0" y2="${svgHeight}" />
${laneRows}
<line class="fh-baseline" x1="0" y1="${barsY}" x2="${CHART_WIDTH}" y2="${barsY}" />
${bars}
${bubbles}
${axisLabels}
</svg>
</div>
<div id="fh-tooltip" class="fh-tooltip" role="tooltip" aria-hidden="true" hidden></div>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
const tooltipEl = document.getElementById('fh-tooltip');
const points = Array.from(document.querySelectorAll('.fh-point'));

function positionTooltip(el) {
  const rect = el.getBoundingClientRect();
  tooltipEl.style.left = '0px';
  tooltipEl.style.top = '0px';
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  let top = rect.top - th - 8;
  if (top < 4) top = rect.bottom + 8;
  let left = Math.max(4, rect.left - tw / 2);
  if (left + tw > window.innerWidth - 4) left = window.innerWidth - 4 - tw;
  tooltipEl.style.top = top + 'px';
  tooltipEl.style.left = left + 'px';
}

function showTooltip(el) {
  const d = el.dataset;
  tooltipEl.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'fh-tooltip-head';
  const avatar = document.createElement('img');
  avatar.className = 'fh-tooltip-avatar';
  avatar.src = d.avatar;
  avatar.alt = '';
  head.append(avatar);
  const author = document.createElement('span');
  author.className = 'fh-tooltip-author';
  author.textContent = d.author;
  head.append(author);
  tooltipEl.append(head);

  const message = document.createElement('div');
  message.className = 'fh-tooltip-message';
  message.textContent = d.message;
  tooltipEl.append(message);

  const meta = document.createElement('div');
  meta.className = 'fh-tooltip-meta';
  meta.textContent = d.age + ' · ' + d.absolute;
  tooltipEl.append(meta);

  const stat = document.createElement('div');
  stat.className = 'fh-tooltip-stat';
  const add = document.createElement('span');
  add.className = 'stat-add';
  add.textContent = '+' + d.insertions;
  const del = document.createElement('span');
  del.className = 'stat-del';
  del.textContent = '\\u2212' + d.deletions;
  stat.append(add, del);
  tooltipEl.append(stat);

  tooltipEl.hidden = false;
  positionTooltip(el);
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

for (const point of points) {
  point.addEventListener('mouseenter', () => showTooltip(point));
  point.addEventListener('mouseleave', hideTooltip);
  point.addEventListener('focus', () => showTooltip(point));
  point.addEventListener('blur', hideTooltip);
  point.addEventListener('click', () => vscode.postMessage({ type: 'openCommit', sha: point.dataset.sha }));
  point.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      vscode.postMessage({ type: 'openCommit', sha: point.dataset.sha });
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTooltip();
});
</script>
</body>
</html>`;
}
