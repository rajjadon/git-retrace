import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFileHistoryHtml } from '../../../src/views/VisualFileHistory/render';
import { layoutFileHistory } from '../../../src/core/graph/fileHistoryLayout';
import type { FileHistoryEntry } from '../../../src/core/git/types';

process.env.TZ = 'UTC';

function entry(sha: string, author: string, authorEmail: string, date: string, insertions: number, deletions: number, message = `commit ${sha}`): FileHistoryEntry {
  return { sha, shortSha: sha.slice(0, 7), author, authorEmail, date, message, insertions, deletions };
}

const now = new Date('2024-04-01T00:00:00Z');
const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/visualFileHistory.css'],
};

test('renderFileHistoryHtml: one bubble per point, tagged with its sha for the click handler', () => {
  const points = layoutFileHistory(
    [entry('A', 'Raj Jadon', 'raj@example.com', '2024-01-01T00:00:00Z', 3, 1)],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  assert.match(html, /data-sha="A"/);
  assert.equal((html.match(/class="fh-bubble"/g) ?? []).length, 1);
});

test('renderFileHistoryHtml: a bigger change gets a strictly larger bubble radius', () => {
  const points = layoutFileHistory(
    [
      entry('BIG', 'Raj Jadon', 'raj@example.com', '2024-03-01T00:00:00Z', 40, 0),
      entry('SMALL', 'Raj Jadon', 'raj@example.com', '2024-01-01T00:00:00Z', 1, 0),
    ],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  const radiusOf = (sha: string): number => {
    const re = new RegExp(`data-sha="${sha}"[\\s\\S]*?class="fh-bubble"[^>]*r="([0-9.]+)"`);
    const match = re.exec(html);
    assert.ok(match, `no bubble found for ${sha}`);
    return Number(match[1]);
  };
  assert.ok(radiusOf('BIG') > radiusOf('SMALL'));
});

test('renderFileHistoryHtml: labels each author lane by name', () => {
  const points = layoutFileHistory(
    [
      entry('B', 'Amy K', 'amy@example.com', '2024-03-01T00:00:00Z', 1, 0),
      entry('A', 'Raj Jadon', 'raj@example.com', '2024-01-01T00:00:00Z', 1, 0),
    ],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  assert.match(html, /Raj Jadon/);
  assert.match(html, /Amy K/);
});

test('renderFileHistoryHtml: escapes commit message and author (attacker-controlled git content)', () => {
  const points = layoutFileHistory(
    [entry('A', '<img src=x onerror=alert(1)>', 'x@example.com', '2024-01-01T00:00:00Z', 1, 0, '<script>alert(1)</script>')],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});

test('renderFileHistoryHtml: bubbles are flat author-colored circles, not avatar photos — no <image> in a chart this dense', () => {
  const points = layoutFileHistory(
    [entry('A', 'Raj Jadon', 'raj@example.com', '2024-01-01T00:00:00Z', 3, 1)],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  assert.ok(!html.includes('<image'), 'expected no <image> elements — bubbles should be flat fills');
  assert.match(html, /class="fh-bubble" cx="[0-9.]+" cy="[0-9.]+" r="[0-9.]+" fill="var\(--vscode-charts-blue\)"/);
});

test('renderFileHistoryHtml: carries structured, escaped tooltip data for the client to build a real card (avatar row, message, meta, stat)', () => {
  const points = layoutFileHistory(
    [entry('A', '<b>Raj</b>', 'raj@example.com', '2024-01-01T00:00:00Z', 12, 4, '<i>fix mime type</i>')],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  assert.match(html, /data-author="&lt;b&gt;Raj&lt;\/b&gt;"/);
  assert.match(html, /data-message="&lt;i&gt;fix mime type&lt;\/i&gt;"/);
  assert.match(html, /data-insertions="12"/);
  assert.match(html, /data-deletions="4"/);
  assert.match(html, /data-avatar="https:\/\/[^"]+"/);
});

test('renderFileHistoryHtml: draws a baseline separating the author lanes from the change-bar band', () => {
  const points = layoutFileHistory(
    [entry('A', 'Raj Jadon', 'raj@example.com', '2024-01-01T00:00:00Z', 3, 1)],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  assert.match(html, /class="fh-baseline"/);
});

test('renderFileHistoryHtml: no commits renders an empty message, not a broken chart', () => {
  const html = renderFileHistoryHtml({ points: [], now }, opts);
  assert.match(html, /No history yet/);
  assert.equal((html.match(/class="fh-bubble"/g) ?? []).length, 0);
});

test('renderFileHistoryHtml: sets a strict CSP with no unsafe-inline', () => {
  const html = renderFileHistoryHtml({ points: [], now }, opts);
  assert.ok(!html.includes('unsafe-inline'));
  assert.match(html, /Content-Security-Policy/);
});

test('renderFileHistoryHtml: commits seconds apart on the same lane render at different cy, not stacked into one blob', () => {
  const points = layoutFileHistory(
    [
      entry('C', 'Raj Jadon', 'raj@example.com', '2024-03-01T00:00:03Z', 5, 0),
      entry('B', 'Raj Jadon', 'raj@example.com', '2024-03-01T00:00:02Z', 5, 0),
      entry('A', 'Raj Jadon', 'raj@example.com', '2024-03-01T00:00:01Z', 5, 0),
    ],
    now,
  );
  const html = renderFileHistoryHtml({ points, now }, opts);
  const cyOf = (sha: string): number => {
    const re = new RegExp(`data-sha="${sha}"[\\s\\S]*?class="fh-bubble"[^>]*cy="([0-9.]+)"`);
    const match = re.exec(html);
    assert.ok(match, `no bubble found for ${sha}`);
    return Number(match[1]);
  };
  const cys = [cyOf('A'), cyOf('B'), cyOf('C')];
  assert.equal(new Set(cys).size, 3, `expected 3 distinct cy values, got ${cys.join(', ')}`);
});

test('renderFileHistoryHtml: axis labels never overlap, even when a burst of commits clusters tightly inside a long history', () => {
  // Eight commits spread evenly across a year, plus a tight two-commit burst (a minute apart)
  // wedged in the middle — real repos hit this on any rebase/squash session. Index-based thinning
  // alone can still pick two labels from inside a burst; only spacing by actual pixel position
  // guarantees no overlap.
  const spread = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01', '2024-06-01', '2024-08-01', '2024-10-01', '2024-12-01'].map(
    (d, i) => entry(`S${i}`, 'Raj Jadon', 'raj@example.com', `${d}T00:00:00Z`, 1, 0),
  );
  const burst = [
    entry('BURST1', 'Raj Jadon', 'raj@example.com', '2024-05-01T00:00:00Z', 1, 0),
    entry('BURST2', 'Raj Jadon', 'raj@example.com', '2024-05-01T00:01:00Z', 1, 0),
  ];
  const points = layoutFileHistory([...spread, ...burst], new Date('2025-01-01T00:00:00Z'));
  const html = renderFileHistoryHtml({ points, now: new Date('2025-01-01T00:00:00Z') }, opts);
  const xs = Array.from(html.matchAll(/class="fh-axis-label" x="([0-9.]+)"/g))
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  assert.ok(xs.length >= 2, 'expected at least 2 axis labels to compare');
  for (let i = 1; i < xs.length; i++) {
    const gap = (xs[i] ?? 0) - (xs[i - 1] ?? 0);
    assert.ok(gap >= 24, `axis labels at ${xs[i - 1]} and ${xs[i]} are only ${gap}px apart — will overlap`);
  }
});
