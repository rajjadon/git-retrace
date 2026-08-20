/**
 * VS Code's own categorical palette (Settings UI, extension charts) — theme-aware for free,
 * unlike a hardcoded hex list that could clash on a light theme or a high-contrast theme. Shared
 * by the commit graph's lane coloring (as CSS custom properties in a webview) and the ownership
 * heatmap's per-author coloring (as ThemeColor ids for editor decorations) — both need "stable
 * index → this palette," just in two different string forms.
 */
export const CHART_THEME_COLOR_IDS = [
  'charts.blue',
  'charts.orange',
  'charts.green',
  'charts.purple',
  'charts.red',
  'charts.yellow',
  'charts.foreground',
];

function idForIndex(index: number): string {
  return CHART_THEME_COLOR_IDS[index % CHART_THEME_COLOR_IDS.length] ?? CHART_THEME_COLOR_IDS[0] ?? 'charts.foreground';
}

/**
 * Fixed categorical palette for webview-rendered lane/author coloring (Commit Graph lanes, Visual
 * File History author lanes) — distinct from `CHART_THEME_COLOR_IDS` below, which feeds *native
 * editor decorations* (the ownership ruler) and must stay theme-derived. This one is fixed because
 * these eight webview panels no longer derive color from the user's VS Code theme at all.
 */
const WEBVIEW_CATEGORICAL_COLOR_VARS = [
  'var(--gl-cat-1)',
  'var(--gl-cat-2)',
  'var(--gl-cat-3)',
  'var(--gl-cat-4)',
  'var(--gl-cat-5)',
  'var(--gl-cat-6)',
];

/** CSS custom property reference for a webview stylesheet — cycles through GitLore's own fixed categorical palette. */
export function chartCssVarForIndex(index: number): string {
  return WEBVIEW_CATEGORICAL_COLOR_VARS[index % WEBVIEW_CATEGORICAL_COLOR_VARS.length] ?? WEBVIEW_CATEGORICAL_COLOR_VARS[0] ?? 'var(--gl-cat-1)';
}

/**
 * VS Code theme color id, for `new vscode.ThemeColor(...)`. Kept as a plain string here (not a
 * real ThemeColor) so this file has zero `vscode` imports and stays importable from `core/`.
 */
export function chartThemeColorIdForIndex(index: number): string {
  return idForIndex(index);
}

/**
 * Ordered hot → cold, unlike `CHART_THEME_COLOR_IDS` (categorical, order carries no meaning) —
 * for the full-file gutter blame's recency gradient, where index 0 must read as "most recent"
 * and the last index as "oldest". Still theme-native ThemeColor ids, never hardcoded hex, so the
 * gradient stays legible across light, dark, and high-contrast themes.
 */
export const RECENCY_GRADIENT_COLOR_IDS = ['charts.red', 'charts.orange', 'charts.yellow', 'charts.green', 'charts.blue'];

/** VS Code theme color id for a recency bucket index (0 = hottest/most recent). Clamped, not wrapped — bucket indices are already bounded by the caller. */
export function recencyGradientColorIdForBucket(index: number): string {
  const clamped = Math.max(0, Math.min(RECENCY_GRADIENT_COLOR_IDS.length - 1, index));
  return RECENCY_GRADIENT_COLOR_IDS[clamped] ?? 'charts.foreground';
}
