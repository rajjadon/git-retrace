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

test('renderPlaceholderHtml: default and "empty" variant carry no live region', () => {
  const withDefault = renderPlaceholderHtml('Nothing yet.', opts);
  const withEmpty = renderPlaceholderHtml('Nothing yet.', { ...opts, variant: 'empty' });
  for (const html of [withDefault, withEmpty]) {
    assert.ok(!html.includes('aria-live'));
    assert.ok(!html.includes('aria-busy'));
    assert.ok(!html.includes('role='));
  }
});

test('renderPlaceholderHtml: "loading" variant shows a shimmering skeleton, carrying the message as an aria-label instead of visible text', () => {
  const html = renderPlaceholderHtml('Loading commit…', { ...opts, variant: 'loading' });
  assert.match(html, /class="skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="Loading commit…"/);
  assert.ok(html.includes('class="skeleton-row"'));
  assert.ok(!html.includes('>Loading commit…<'));
});

test('renderPlaceholderHtml: "loading" variant escapes its message in the aria-label attribute', () => {
  const html = renderPlaceholderHtml('Loading "quoted" <script>', { ...opts, variant: 'loading' });
  assert.ok(!html.includes('aria-label="Loading "quoted"'));
  assert.match(html, /aria-label="Loading &quot;quoted&quot; &lt;script&gt;"/);
});

test('renderPlaceholderHtml: "error" variant announces as an alert', () => {
  const html = renderPlaceholderHtml('GitLore: failed to load commit — boom', { ...opts, variant: 'error' });
  assert.match(html, /role="alert"/);
  assert.ok(!html.includes('aria-busy'));
});
