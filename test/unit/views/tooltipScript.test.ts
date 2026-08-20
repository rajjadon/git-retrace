import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTooltipScript } from '../../../src/views/tooltipScript';

test('renderTooltipScript: creates one shared tooltip element with role="tooltip"', () => {
  const script = renderTooltipScript();
  assert.match(script, /tooltip\.className = 'gitlore-tooltip';/);
  assert.match(script, /tooltip\.setAttribute\('role', 'tooltip'\);/);
});

test('renderTooltipScript: wires every [data-tooltip] element to show/hide on hover and focus', () => {
  const script = renderTooltipScript();
  assert.match(script, /document\.querySelectorAll\('\[data-tooltip\]'\)/);
  assert.match(script, /addEventListener\('mouseenter'/);
  assert.match(script, /addEventListener\('focus'/);
  assert.match(script, /addEventListener\('mouseleave'/);
  assert.match(script, /addEventListener\('blur'/);
});

test('renderTooltipScript: reads the tooltip text from the element\'s own data-tooltip attribute', () => {
  const script = renderTooltipScript();
  assert.match(script, /target\.dataset\.tooltip/);
});
