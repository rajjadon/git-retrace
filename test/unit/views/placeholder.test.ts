import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlaceholderHtml } from '../../../src/views/placeholder';

const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/commitDetails.css'],
};

test('renderPlaceholderHtml: states what to do, styled like the loaded view', () => {
  const html = renderPlaceholderHtml('Select a commit in the Commit Graph to see its details.', opts);
  assert.match(html, /class="empty">Select a commit in the Commit Graph to see its details\.<\/p>/);
  assert.match(html, /shared\.css/);
  assert.match(html, /commitDetails\.css/);
});

test('renderPlaceholderHtml: needs no script, so its CSP grants none', () => {
  const html = renderPlaceholderHtml('Nothing yet.', opts);
  assert.match(html, /default-src 'none'; style-src vscode-webview:\/\/xyz;/);
  assert.ok(!html.includes('script-src'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('unsafe-inline'));
});

test('renderPlaceholderHtml: escapes its message', () => {
  const html = renderPlaceholderHtml('<script>alert(1)</script>', opts);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
