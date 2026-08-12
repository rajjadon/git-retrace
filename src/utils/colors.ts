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

/** CSS custom property reference for a webview stylesheet, e.g. `var(--vscode-charts-blue)`. */
export function chartCssVarForIndex(index: number): string {
  return `var(--vscode-${idForIndex(index).replace('.', '-')})`;
}

/**
 * VS Code theme color id, for `new vscode.ThemeColor(...)`. Kept as a plain string here (not a
 * real ThemeColor) so this file has zero `vscode` imports and stays importable from `core/`.
 */
export function chartThemeColorIdForIndex(index: number): string {
  return idForIndex(index);
}
