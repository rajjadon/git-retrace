import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRebaseEditorHtml } from '../../../src/views/RebaseEditor/render';
import type { RebaseEntry } from '../../../src/core/git/rebaseTodo';

function entry(overrides: Partial<RebaseEntry> = {}): RebaseEntry {
  return { editable: true, command: 'pick', sha: 'a1b2c3d', message: 'a commit', raw: 'pick a1b2c3d a commit', ...overrides };
}

const opts = { nonce: 'abc123', cspSource: 'vscode-webview://xyz', styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/rebaseEditor.css'] };

test('renderRebaseEditorHtml: renders one row per entry, in order', () => {
  const entries = [entry({ sha: 'aaaaaaa', message: 'first' }), entry({ sha: 'bbbbbbb', message: 'second' })];
  const html = renderRebaseEditorHtml({ entries }, opts);
  assert.match(html, /aaaaaaa[\s\S]*first[\s\S]*bbbbbbb[\s\S]*second/);
});

test('renderRebaseEditorHtml: an editable row offers all six actions, with the entry\'s own command selected', () => {
  const html = renderRebaseEditorHtml({ entries: [entry({ command: 'squash' })] }, opts);
  for (const action of ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']) {
    assert.match(html, new RegExp(`<option value="${action}"`));
  }
  assert.match(html, /<option value="squash" selected>/);
});

test('renderRebaseEditorHtml: a non-editable entry (exec/label/etc.) shows its raw text with no action dropdown', () => {
  const html = renderRebaseEditorHtml({ entries: [entry({ editable: false, command: '', sha: '', message: '', raw: 'exec npm test' })] }, opts);
  assert.match(html, /exec npm test/);
  assert.ok(!html.includes('<select'));
});

test('renderRebaseEditorHtml: the first row\'s move-up and the last row\'s move-down are disabled', () => {
  const entries = [entry({ sha: 'aaaaaaa' }), entry({ sha: 'bbbbbbb' }), entry({ sha: 'ccccccc' })];
  const html = renderRebaseEditorHtml({ entries }, opts);
  const rows = html.split('class="rb-row ').slice(1);
  assert.equal(rows.length, 3);
  assert.match(rows[0] ?? '', /rb-move-up"[^>]*disabled/);
  assert.doesNotMatch(rows[0] ?? '', /rb-move-down"[^>]*disabled/);
  assert.doesNotMatch(rows[2] ?? '', /rb-move-up"[^>]*disabled/);
  assert.match(rows[2] ?? '', /rb-move-down"[^>]*disabled/);
});

test('renderRebaseEditorHtml: move-up and move-down carry a visible tooltip, not just an aria-label', () => {
  const html = renderRebaseEditorHtml({ entries: [entry()] }, opts);
  assert.match(html, /rb-move-up"[^>]*data-tooltip="Move up"/);
  assert.match(html, /rb-move-down"[^>]*data-tooltip="Move down"/);
});

test('renderRebaseEditorHtml: offers Start Rebase and Abort actions', () => {
  const html = renderRebaseEditorHtml({ entries: [entry()] }, opts);
  assert.match(html, /id="start-rebase"/);
  assert.match(html, /id="abort-rebase"/);
});

test('renderRebaseEditorHtml: escapes commit message and raw text (attacker-controlled git content)', () => {
  const html = renderRebaseEditorHtml(
    {
      entries: [
        entry({ message: '<script>alert(1)</script>' }),
        entry({ editable: false, raw: '<img src=x onerror=alert(2)>' }),
      ],
    },
    opts,
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(2)>'));
});

test('renderRebaseEditorHtml: summarizes how many commits will be affected', () => {
  const html = renderRebaseEditorHtml({ entries: [entry(), entry(), entry({ editable: false, raw: 'exec x' })] }, opts);
  assert.match(html, /2 commits/);
});

test('renderRebaseEditorHtml: sets a strict CSP with no unsafe-inline', () => {
  const html = renderRebaseEditorHtml({ entries: [] }, opts);
  assert.ok(!html.includes('unsafe-inline'));
  assert.match(html, /Content-Security-Policy/);
});

test('renderRebaseEditorHtml: each editable row carries a stable data-sha for FLIP tracking across reorders', () => {
  const html = renderRebaseEditorHtml({ entries: [entry({ sha: 'abc1234', message: 'fix bug' })] }, opts);
  assert.match(html, /<div class="rb-row rb-row-pick" role="listitem" draggable="true" data-index="0" data-sha="abc1234">/);
});

test('renderRebaseEditorHtml: an empty entry list still renders a usable shell (Abort works on nothing to rebase)', () => {
  const html = renderRebaseEditorHtml({ entries: [] }, opts);
  assert.match(html, /id="abort-rebase"/);
  assert.match(html, /0 commits/);
});
