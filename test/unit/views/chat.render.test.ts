import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChatHtml } from '../../../src/views/Chat/render';

const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/chat.css'],
};

test('renderChatHtml: renders the message log, input form, and Ask button', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /id="chat-messages"/);
  assert.match(html, /id="chat-text"/);
  assert.match(html, /id="chat-send"/);
});

test('renderChatHtml: with no subjectLabel, shows no subject chip', () => {
  const html = renderChatHtml({}, opts);
  assert.ok(!html.includes('chat-subject'));
});

test('renderChatHtml: with a subjectLabel, shows it in a subject chip, HTML-escaped', () => {
  const html = renderChatHtml({ subjectLabel: '<script>alert(1)</script>' }, opts);
  assert.match(html, /class="chat-subject"/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderChatHtml: submitting the form posts send with the textarea value', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /vscode\.postMessage\(\{ type: 'send', text \}\);/);
});

test('renderChatHtml: the new-chat button posts newChat', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /getElementById\('new-chat'\)\.addEventListener\('click', \(\) => \{[\s\S]*vscode\.postMessage\(\{ type: 'newChat' \}\);/);
});

test('renderChatHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz/);
  assert.ok(!html.includes('unsafe-inline'));
});
