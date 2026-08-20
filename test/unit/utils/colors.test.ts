import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_THEME_COLOR_IDS,
  RECENCY_GRADIENT_COLOR_IDS,
  chartCssVarForIndex,
  chartThemeColorIdForIndex,
  recencyGradientColorIdForBucket,
} from '../../../src/utils/colors';

test('chartThemeColorIdForIndex: returns the theme color id at that index', () => {
  assert.equal(chartThemeColorIdForIndex(0), 'charts.blue');
  assert.equal(chartThemeColorIdForIndex(1), 'charts.orange');
});

test('chartThemeColorIdForIndex: wraps past the palette length', () => {
  assert.equal(chartThemeColorIdForIndex(CHART_THEME_COLOR_IDS.length), chartThemeColorIdForIndex(0));
});

test('chartCssVarForIndex: cycles through the fixed webview categorical palette, not a VS Code theme lookup', () => {
  assert.equal(chartCssVarForIndex(0), 'var(--gl-cat-1)');
  assert.equal(chartCssVarForIndex(6), 'var(--gl-cat-1)'); // wraps
});

test('chartThemeColorIdForIndex is untouched — still a VS Code theme color id for editor decorations', () => {
  assert.equal(chartThemeColorIdForIndex(0), 'charts.blue');
});

test('recencyGradientColorIdForBucket: index 0 is the hottest color (red)', () => {
  assert.equal(recencyGradientColorIdForBucket(0), 'charts.red');
});

test('recencyGradientColorIdForBucket: the last index is the coldest color (blue)', () => {
  assert.equal(recencyGradientColorIdForBucket(RECENCY_GRADIENT_COLOR_IDS.length - 1), 'charts.blue');
});

test('recencyGradientColorIdForBucket: clamps rather than wraps past the palette length', () => {
  assert.equal(recencyGradientColorIdForBucket(RECENCY_GRADIENT_COLOR_IDS.length), 'charts.blue');
  assert.equal(recencyGradientColorIdForBucket(-1), 'charts.red');
});
