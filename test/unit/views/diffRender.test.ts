import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiff, renderFileSections, splitDiffByFile } from '../../../src/views/diffRender';
import type { FileChange } from '../../../src/core/git/types';

function file(path: string, overrides: Partial<FileChange> = {}): FileChange {
  return { path, insertions: 1, deletions: 0, binary: false, ...overrides };
}

const twoFileDiff = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '+added',
  'diff --git a/README.md b/README.md',
  'index 3333333..4444444 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -5,3 +5,2 @@',
  '-gone',
  '',
].join('\n');

test('splitDiffByFile: keys each file by its post-image path', () => {
  assert.deepEqual([...splitDiffByFile(twoFileDiff).keys()], ['src/a.ts', 'README.md']);
});

test('splitDiffByFile: keeps only hunks, dropping the per-file header noise', () => {
  const section = splitDiffByFile(twoFileDiff).get('src/a.ts') ?? '';
  assert.match(section, /^@@ -1,2 \+1,3 @@/);
  assert.ok(!section.includes('diff --git'));
  assert.ok(!section.includes('index 1111111'));
  assert.ok(!section.includes('--- a/src/a.ts'));
  assert.ok(!section.includes('+++ b/src/a.ts'));
});

test('splitDiffByFile: does not leak one file\'s hunks into the next file\'s section', () => {
  const sections = splitDiffByFile(twoFileDiff);
  assert.ok(!(sections.get('src/a.ts') ?? '').includes('-gone'));
  assert.ok(!(sections.get('README.md') ?? '').includes('+added'));
});

test('splitDiffByFile: a path containing spaces round-trips intact', () => {
  const diff = 'diff --git a/my notes/todo list.md b/my notes/todo list.md\n@@ -1 +1 @@\n+hi\n';
  assert.deepEqual([...splitDiffByFile(diff).keys()], ['my notes/todo list.md']);
});

test('splitDiffByFile: a rename is keyed by the new path', () => {
  const diff = [
    'diff --git a/old/name.ts b/new/name.ts',
    'similarity index 92%',
    'rename from old/name.ts',
    'rename to new/name.ts',
    '@@ -1 +1 @@',
    '+x',
  ].join('\n');
  assert.deepEqual([...splitDiffByFile(diff).keys()], ['new/name.ts']);
});

test('splitDiffByFile: a binary file maps to an empty section rather than being dropped', () => {
  const diff = 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n';
  assert.deepEqual(splitDiffByFile(diff).get('logo.png'), '');
});

test('splitDiffByFile: an empty diff yields no sections', () => {
  assert.equal(splitDiffByFile('').size, 0);
});

test('renderFileSections: renders one collapsible section per file with its own hunks', () => {
  const html = renderFileSections([file('src/a.ts'), file('README.md', { deletions: 1, insertions: 0 })], twoFileDiff);
  assert.equal((html.match(/<details class="file"/g) ?? []).length, 2);
  assert.match(html, /class="file-dir">src\/<\/span><span class="file-name">a\.ts</);
  assert.match(html, /class="dc diff-add">\+added</);
  assert.match(html, /class="dc diff-del">-gone</);
});

test('renderFileSections: a sole changed file opens by default; several stay collapsed', () => {
  const single = renderFileSections([file('src/a.ts')], twoFileDiff);
  assert.match(single, /<details class="file" open/);

  const many = renderFileSections([file('src/a.ts'), file('README.md')], twoFileDiff);
  assert.ok(!many.includes('<details class="file" open'));
});

test('renderFileSections: carries a lowercased path for the filter box', () => {
  const html = renderFileSections([file('src/Views/Render.ts')], '');
  assert.match(html, /data-filter="src\/views\/render\.ts"/);
});

test('renderFileSections: a file with no textual diff says so instead of rendering an empty block', () => {
  const html = renderFileSections([file('logo.png', { binary: true, insertions: 0, deletions: 0 })], '');
  assert.match(html, /No textual diff for this file\./);
  assert.match(html, /class="muted">binary</);
  assert.ok(!html.includes('<pre class="diff">'));
});

test('renderFileSections: an empty file list says "No files changed."', () => {
  assert.match(renderFileSections([], ''), /No files changed\./);
});

test('renderFileSections: escapes path and diff content', () => {
  const path = '<img src=x onerror=alert(1)>.ts';
  const diff = `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n+<script>alert(1)</script>\n`;
  const html = renderFileSections([file(path)], diff);
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderDiff: numbers each line from the hunk header, on the side it exists', () => {
  const html = renderDiff('@@ -10,3 +20,4 @@\n ctx\n-removed\n+added\n');
  // Hunk header itself sits on neither side.
  assert.match(html, /<span class="dn dn-old"><\/span><span class="dn dn-new"><\/span><span class="dc diff-hunk">@@ -10,3 \+20,4 @@/);
  // Context advances both counters.
  assert.match(html, /<span class="dn dn-old">10<\/span><span class="dn dn-new">20<\/span><span class="dc diff-ctx"> ctx</);
  // A removed line exists only in the old file.
  assert.match(html, /<span class="dn dn-old">11<\/span><span class="dn dn-new"><\/span><span class="dc diff-del">-removed</);
  // An added line exists only in the new file — and does not consume an old-side number.
  assert.match(html, /<span class="dn dn-old"><\/span><span class="dn dn-new">21<\/span><span class="dc diff-add">\+added</);
});

test('renderDiff: a second hunk restarts numbering from its own header', () => {
  const html = renderDiff('@@ -1,1 +1,1 @@\n a\n@@ -50,1 +60,1 @@\n b\n');
  assert.match(html, /<span class="dn dn-old">1<\/span><span class="dn dn-new">1<\/span><span class="dc diff-ctx"> a</);
  assert.match(html, /<span class="dn dn-old">50<\/span><span class="dn dn-new">60<\/span><span class="dc diff-ctx"> b</);
});

test('renderDiff: a fragment with no hunk header renders empty gutters rather than guessing', () => {
  const html = renderDiff('+orphan line\n');
  assert.match(html, /<span class="dn dn-old"><\/span><span class="dn dn-new"><\/span><span class="dc diff-add">\+orphan line</);
});

test('renderDiff: "\\ No newline at end of file" is a note, not a numbered line', () => {
  const html = renderDiff('@@ -1,1 +1,1 @@\n a\n\\ No newline at end of file\n b\n');
  // It gets no number of its own...
  assert.match(html, /<span class="dn dn-old"><\/span><span class="dn dn-new"><\/span><span class="dc diff-ctx">\\ No newline/);
  // ...and does not consume one, so the next real line is 2, not 3.
  assert.match(html, /<span class="dn dn-old">2<\/span><span class="dn dn-new">2<\/span><span class="dc diff-ctx"> b</);
});

test('renderDiff: rows are concatenated with no newline, so the <pre> gets no phantom blank lines', () => {
  const html = renderDiff('@@ -1,1 +1,1 @@\n a\n b\n');
  assert.ok(!html.includes('</span>\n<span class="dl">'));
  assert.equal((html.match(/class="dl"/g) ?? []).length, 3);
});

test('renderDiff: drops the trailing empty line left by splitting on the final newline', () => {
  assert.equal((renderDiff('@@ -1,1 +1,1 @@\n a\n').match(/class="dl"/g) ?? []).length, 2);
});

test('renderDiff: escapes diff content', () => {
  assert.ok(!renderDiff('+<script>alert(1)</script>\n').includes('<script>alert(1)</script>'));
});

test('renderFileSections: each file row offers an Open changes button carrying its path', () => {
  const html = renderFileSections([file('src/a.ts')], twoFileDiff);
  assert.match(html, /class="row-btn" type="button" data-path="src\/a\.ts" title="Open changes"/);
  assert.match(html, /aria-label="Open changes in src\/a\.ts"/);
});
