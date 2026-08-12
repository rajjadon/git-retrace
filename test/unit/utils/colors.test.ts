import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_THEME_COLOR_IDS, chartCssVarForIndex, chartThemeColorIdForIndex } from '../../../src/utils/colors';

test('chartThemeColorIdForIndex: returns the theme color id at that index', () => {
  assert.equal(chartThemeColorIdForIndex(0), 'charts.blue');
  assert.equal(chartThemeColorIdForIndex(1), 'charts.orange');
});

test('chartThemeColorIdForIndex: wraps past the palette length', () => {
  assert.equal(chartThemeColorIdForIndex(CHART_THEME_COLOR_IDS.length), chartThemeColorIdForIndex(0));
});

test('chartCssVarForIndex: returns a CSS var() reference for the theme color id at that index', () => {
  assert.equal(chartCssVarForIndex(0), 'var(--vscode-charts-blue)');
});

test('chartCssVarForIndex: wraps past the palette length', () => {
  assert.equal(chartCssVarForIndex(CHART_THEME_COLOR_IDS.length), chartCssVarForIndex(0));
});

test('chartCssVarForIndex and chartThemeColorIdForIndex agree on the same color for every index', () => {
  for (let i = 0; i < CHART_THEME_COLOR_IDS.length; i++) {
    const expectedVar = `var(--vscode-${chartThemeColorIdForIndex(i).replace('.', '-')})`;
    assert.equal(chartCssVarForIndex(i), expectedVar);
  }
});
