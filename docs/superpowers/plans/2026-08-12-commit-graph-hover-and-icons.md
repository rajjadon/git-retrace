# Commit Graph: Row Hover Tooltip + Icon-Only Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two concrete UX gaps in GitLore's Commit Graph webview — a rich hover/focus tooltip on rows (consolidating info already scattered across native `title` attributes), and icon-only headers for the four densest columns — both purely theme-native, no new data flow, no new settings.

**Architecture:** Both changes live entirely inside `src/views/CommitGraph/render.ts` (markup + inline script), `media/commitGraph.css` (styling), and `src/views/icons.ts` (three new small SVG icon constants). The tooltip is a single shared `<div>` populated at hover/focus time by reading values straight out of the already-rendered row's own DOM (no new server-side computation, no new data threaded through `GraphData`).

**Tech Stack:** TypeScript (strict), plain DOM APIs in the webview's inline script (no framework), existing `icon()` SVG helper pattern.

## Global Constraints

- No `any`. No non-null `!` without an inline comment justifying it.
- No new `vscode.*` API usage, no new settings, no new commands, no new provider/service/`core/` changes — this is presentation-only, scoped to the three files above.
- All colors come from existing `--vscode-*` theme variables — no hardcoded hex.
- Every icon-only header keeps a real `title` and `aria-label` naming the column, so `role="columnheader"` still announces the real name to a screen reader.
- The tooltip must build repo-controlled text (author name, commit message) via `.textContent =` assignment, **never** via `innerHTML` string concatenation — `textContent` read off an existing element gives back the *decoded* string, and concatenating that into a new `innerHTML` would let a maliciously-crafted author name or commit message be re-parsed as live HTML in the tooltip. Numeric/server-computed content (file/insertion/deletion counts) has no such risk and may be cloned or read via `textContent` either way.
- Out of scope (per spec): the mini history-overview sparkline, any change to how many commits are loaded, any AI/search/Pro-tier feature.

---

### Task 1: Icon-only column headers

**Files:**
- Modify: `src/views/icons.ts`
- Modify: `src/views/CommitGraph/render.ts`
- Test: `test/unit/views/commitGraph.render.test.ts`

**Interfaces:**
- Consumes: the existing `icon(body: string, className: string, size = 14): string` helper in `icons.ts`; the existing `FILE_COUNT_ICON` export.
- Produces: three new exports from `icons.ts` — `AUTHOR_ICON`, `CLOCK_ICON`, `HASH_ICON` — consumed only by `render.ts`'s header row in this task (no other file needs them).

- [ ] **Step 1: Write the failing test**

In `test/unit/views/commitGraph.render.test.ts`, replace the existing test (it currently asserts all 7 headers are plain text, which this task changes for 4 of them):

Find this test:
```ts
test('renderGraphHtml: renders GitLens\'s seven column headers', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  for (const header of ['Branch / Tag', 'Graph', 'Commit Message', 'Author', 'Changes', 'Commit Date', 'SHA']) {
    assert.match(html, new RegExp(`role="columnheader">${header.replace(/\//g, '\\/')}<`));
  }
});
```

Replace it with:
```ts
test('renderGraphHtml: renders the three text column headers (Branch/Tag, Graph, Commit Message)', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  for (const header of ['Branch / Tag', 'Graph', 'Commit Message']) {
    assert.match(html, new RegExp(`role="columnheader">${header.replace(/\//g, '\\/')}<`));
  }
});

test('renderGraphHtml: Author/Changes/Commit Date/SHA headers are icon-only, with a title and aria-label naming the column', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /role="columnheader" title="Author" aria-label="Author"><svg/);
  assert.match(html, /role="columnheader" title="Changes" aria-label="Changes"><svg/);
  assert.match(html, /role="columnheader" title="Commit Date" aria-label="Commit Date"><svg/);
  assert.match(html, /role="columnheader" title="SHA" aria-label="SHA"><svg/);
  assert.ok(!html.includes('role="columnheader">Author<'));
  assert.ok(!html.includes('role="columnheader">Changes<'));
  assert.ok(!html.includes('role="columnheader">Commit Date<'));
  assert.ok(!html.includes('role="columnheader">SHA<'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test test/unit/views/commitGraph.render.test.ts`
Expected: the new "Author/Changes/Commit Date/SHA headers are icon-only" test FAILS (headers are still plain text); the renamed three-header test passes already (no change needed to make it pass, since those 3 stay text — this is expected and fine).

- [ ] **Step 3: Add the three new icons to `src/views/icons.ts`**

Add these three exports at the end of the file, after `AI_ICON`:

```ts
/** Author column header — a simple head-and-shoulders glyph. */
export const AUTHOR_ICON = icon(
  '<circle cx="8" cy="5.3" r="2.6" /><path d="M3 13.3c0-2.9 2.2-4.6 5-4.6s5 1.7 5 4.6" />',
  'ref-icon',
  12,
);

/** Commit Date column header. */
export const CLOCK_ICON = icon('<circle cx="8" cy="8" r="5.3" /><path d="M8 5.2v3l2 1.2" />', 'ref-icon', 12);

/** SHA column header — a hash mark, since a git SHA is a hash. */
export const HASH_ICON = icon(
  '<path d="M6.2 2.5 4.6 13.5M11.4 2.5 9.8 13.5M3 6.3h10M2.6 9.7h10" />',
  'ref-icon',
  12,
);
```

- [ ] **Step 4: Update the header row markup in `src/views/CommitGraph/render.ts`**

First, update the import line to bring in the three new icons and `FILE_COUNT_ICON` is already imported — the full import block becomes:

```ts
import {
  AUTHOR_ICON,
  BRANCH_ICON,
  CLOCK_ICON,
  FILE_COUNT_ICON,
  HASH_ICON,
  PENDING_ICON,
  REFRESH_ICON,
  REMOTE_ICON,
  SEARCH_ICON,
  TAG_ICON,
} from '../icons';
```

Then find the header row markup:
```ts
<div class="row header" role="row">
<span class="cell" role="columnheader">Branch / Tag</span>
<span class="cell" role="columnheader">Graph</span>
<span class="cell" role="columnheader">Commit Message</span>
<span class="cell" role="columnheader">Author</span>
<span class="cell" role="columnheader">Changes</span>
<span class="cell" role="columnheader">Commit Date</span>
<span class="cell" role="columnheader">SHA</span>
</div>
```

Replace it with:
```ts
<div class="row header" role="row">
<span class="cell" role="columnheader">Branch / Tag</span>
<span class="cell" role="columnheader">Graph</span>
<span class="cell" role="columnheader">Commit Message</span>
<span class="cell" role="columnheader" title="Author" aria-label="Author">${AUTHOR_ICON}</span>
<span class="cell" role="columnheader" title="Changes" aria-label="Changes">${FILE_COUNT_ICON}</span>
<span class="cell" role="columnheader" title="Commit Date" aria-label="Commit Date">${CLOCK_ICON}</span>
<span class="cell" role="columnheader" title="SHA" aria-label="SHA">${HASH_ICON}</span>
</div>
```

(`FILE_COUNT_ICON` deliberately reused as-is — same glyph the Changes column's own cells already show, per the design doc, rather than a separate header-specific icon.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test test/unit/views/commitGraph.render.test.ts`
Expected: PASS — both tests from Step 1 green, and no other test in this file regresses (spot check: run the whole file, not just the new tests).

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: passes clean.

- [ ] **Step 7: Stage the changes**

```bash
git add src/views/icons.ts src/views/CommitGraph/render.ts test/unit/views/commitGraph.render.test.ts
```

Do not commit — see Global Constraints in the sibling stale-code-detector plan; this project's owner commits personally. Never run `git commit`.

---

### Task 2: Row hover/focus tooltip

**Files:**
- Modify: `src/views/CommitGraph/render.ts`
- Modify: `media/commitGraph.css`
- Test: `test/unit/views/commitGraph.render.test.ts`

**Interfaces:**
- Consumes: nothing new from other files — reads exclusively from the row markup Task 1 leaves unchanged in this respect (`.cell-graph image[href]`, `.cell-author`, `.cell-message[title]`, `.cell-date` + its `title`, `.cell-sha code`, `.cell-changes` + its `title`), all of which already exist in `render.ts`'s current row-rendering code before this task starts.
- Produces: nothing consumed by other tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing tests**

Add these tests to `test/unit/views/commitGraph.render.test.ts`, after the icon-header tests added in Task 1:

```ts
test('renderGraphHtml: includes exactly one shared row-tooltip container', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  const matches = html.match(/id="row-tooltip"/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(html, /<div id="row-tooltip" class="row-tooltip" role="tooltip" hidden><\/div>/);
});

test('renderGraphHtml: rows show/hide the tooltip on hover, keyboard focus, scroll, and Escape', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /addEventListener\('mouseenter', \(\) => showTooltip\(row\)\)/);
  assert.match(html, /addEventListener\('mouseleave', hideTooltip\)/);
  assert.match(html, /addEventListener\('focus', \(\) => showTooltip\(row\)\)/);
  assert.match(html, /addEventListener\('blur', hideTooltip\)/);
  assert.match(html, /querySelector\('\.grid'\)\.addEventListener\('scroll', hideTooltip\)/);
  assert.match(html, /e\.key === 'Escape'/);
});

test('renderGraphHtml: the tooltip reads content from the row\'s own already-rendered cells, not a new data path', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /querySelector\('\.cell-graph image'\)/);
  assert.match(html, /querySelector\('\.cell-author'\)/);
  assert.match(html, /querySelector\('\.cell-message'\)\?\.getAttribute\('title'\)/);
  assert.match(html, /querySelector\('\.cell-date'\)/);
  assert.match(html, /querySelector\('\.cell-sha code'\)/);
  assert.match(html, /querySelector\('\.cell-changes'\)/);
});

test('renderGraphHtml: builds repo-controlled author/message text via textContent, never innerHTML concatenation', () => {
  // Regression guard: textContent read off an existing element returns the *decoded* string. If
  // that string were concatenated into a new innerHTML assignment instead of set via textContent,
  // a maliciously-crafted author name or commit message (e.g. containing "<img onerror=...>")
  // would be re-parsed as live HTML in the tooltip. Pinning the exact safe assignment pattern here.
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /authorText\.textContent = row\.querySelector\('\.cell-author'\)\?\.textContent \|\| ''/);
  assert.match(html, /message\.textContent = row\.querySelector\('\.cell-message'\)\?\.getAttribute\('title'\) \|\| ''/);
});

test('renderGraphHtml: the Working Changes row gets its own tooltip branch, reusing its existing status badges', () => {
  const html = renderGraphHtml({ nodes: layoutGraph([commit('A', [])]), now }, opts);
  assert.match(html, /row\.dataset\.wip/);
  assert.match(html, /row\.querySelector\('\.cell-changes'\)\.cloneNode\(true\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test test/unit/views/commitGraph.render.test.ts`
Expected: FAIL — all 5 new tests fail (no tooltip markup/script exists yet).

- [ ] **Step 3: Add the tooltip container to the document body**

In `src/views/CommitGraph/render.ts`, find:
```ts
<div class="rows" id="rows">
${hasWip ? renderWorkingChangesRow(workingChanges, svgWidth, wipTabbable) : ''}
${rows}
</div>
${empty ? '<p class="empty">No commits yet.</p>' : ''}
</div>
<script nonce="${opts.nonce}">
```

Replace it with (adding the tooltip container right after the closing `</div>` of `.grid`, so it's not clipped by the grid's own `overflow: auto`):
```ts
<div class="rows" id="rows">
${hasWip ? renderWorkingChangesRow(workingChanges, svgWidth, wipTabbable) : ''}
${rows}
</div>
${empty ? '<p class="empty">No commits yet.</p>' : ''}
</div>
<div id="row-tooltip" class="row-tooltip" role="tooltip" hidden></div>
<script nonce="${opts.nonce}">
```

- [ ] **Step 4: Add the tooltip script**

In the same file's `<script>` block, find:
```ts
for (const row of allRows) {
  row.addEventListener('click', () => select(row));
}
```

Replace it with (adding the tooltip logic and wiring the new listeners into the same loop):
```ts
const tooltipEl = document.getElementById('row-tooltip');

function positionTooltip(row) {
  const rect = row.getBoundingClientRect();
  tooltipEl.style.left = '0px';
  tooltipEl.style.top = '0px';
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  let top = rect.bottom + 4;
  if (top + th > window.innerHeight) {
    top = Math.max(4, rect.top - th - 4);
  }
  let left = rect.left;
  if (left + tw > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - 8 - tw);
  }
  tooltipEl.style.top = top + 'px';
  tooltipEl.style.left = left + 'px';
}

function showTooltip(row) {
  tooltipEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'row-tooltip-head';

  if (row.dataset.wip) {
    head.textContent = 'Working Changes';
    tooltipEl.append(head);

    const stat = row.querySelector('.cell-changes').cloneNode(true);
    stat.className = 'row-tooltip-stat';
    tooltipEl.append(stat);

    const meta = document.createElement('div');
    meta.className = 'row-tooltip-meta';
    meta.textContent = 'Uncommitted — open the Source Control view';
    tooltipEl.append(meta);
  } else {
    const avatarUrl = row.querySelector('.cell-graph image')?.getAttribute('href') || '';
    const avatar = document.createElement('img');
    avatar.className = 'row-tooltip-avatar';
    avatar.src = avatarUrl;
    avatar.width = 20;
    avatar.height = 20;
    avatar.alt = '';
    head.append(avatar);

    const authorText = document.createElement('span');
    authorText.textContent = row.querySelector('.cell-author')?.textContent || '';
    head.append(authorText);
    tooltipEl.append(head);

    const message = document.createElement('div');
    message.className = 'row-tooltip-message';
    message.textContent = row.querySelector('.cell-message')?.getAttribute('title') || '';
    tooltipEl.append(message);

    const dateCell = row.querySelector('.cell-date');
    const meta = document.createElement('div');
    meta.className = 'row-tooltip-meta';
    meta.textContent = [dateCell?.textContent, dateCell?.getAttribute('title'), row.querySelector('.cell-sha code')?.textContent]
      .filter(Boolean)
      .join(' · ');
    tooltipEl.append(meta);

    const stat = document.createElement('div');
    stat.className = 'row-tooltip-stat';
    stat.textContent = row.querySelector('.cell-changes')?.getAttribute('title') || '';
    tooltipEl.append(stat);
  }

  tooltipEl.hidden = false;
  positionTooltip(row);
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

for (const row of allRows) {
  row.addEventListener('click', () => select(row));
  row.addEventListener('mouseenter', () => showTooltip(row));
  row.addEventListener('mouseleave', hideTooltip);
  row.addEventListener('focus', () => showTooltip(row));
  row.addEventListener('blur', hideTooltip);
}

document.querySelector('.grid').addEventListener('scroll', hideTooltip);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTooltip();
});
```

- [ ] **Step 5: Add tooltip styles to `media/commitGraph.css`**

Append this block at the end of the file, before the `@media (prefers-reduced-motion: reduce)` block:

```css
/* ---------- Row tooltip ---------- */

.row-tooltip {
  position: fixed;
  z-index: 10;
  max-width: 360px;
  padding: 0.5rem 0.6rem;
  border-radius: 3px;
  background-color: var(--vscode-editorHoverWidget-background);
  border: 1px solid var(--vscode-editorHoverWidget-border);
  color: var(--vscode-editorHoverWidget-foreground);
  font-size: 0.95em;
  line-height: 1.5;
  pointer-events: none;
}

.row-tooltip[hidden] {
  display: none;
}

.row-tooltip-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
}

.row-tooltip-avatar {
  border-radius: 50%;
  flex: 0 0 auto;
}

.row-tooltip-message {
  margin: 0 0 0.3rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.row-tooltip-meta,
.row-tooltip-stat {
  opacity: 0.75;
  font-size: 0.92em;
}
```

This must land before the `@media (prefers-reduced-motion: reduce)` block so that block's `* { transition: none !important; }` continues to apply universally (it already covers `.row-tooltip` automatically since it targets `*`, but keeping new rules above it preserves the file's existing convention of that block being the last thing in the file).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test test/unit/views/commitGraph.render.test.ts`
Expected: PASS — all 5 new tests green, and the full file's existing tests still pass (no regressions).

- [ ] **Step 7: Run the full unit suite and lint**

Run: `npm run test:unit`
Expected: PASS, all tests green (existing count plus the 6 new tests from Task 1 + Task 2 combined — 2 from Task 1's replaced/added tests, 5 from Task 2, net +6 vs. the pre-Task-1 baseline since Task 1 replaced 1 test with 2).

Run: `npm run lint`
Expected: passes clean.

- [ ] **Step 8: Stage the changes**

```bash
git add src/views/CommitGraph/render.ts media/commitGraph.css test/unit/views/commitGraph.render.test.ts
```

Do not commit. Never run `git commit`.

---

## Verification (whole feature)

- [ ] `npm run lint` passes clean (ESLint + `tsc --noEmit`).
- [ ] `npm run test:unit` passes clean, including all new tests from both tasks.
- [ ] Manual check in the Extension Development Host (F5): open the Commit Graph panel — confirm Author/Changes/Commit Date/SHA headers now show icons (hovering each shows its real name as a native tooltip from the `title` attribute). Hover a commit row: confirm a tooltip appears immediately below (or above, if near the bottom) showing avatar, author, full message, age/date/sha, and diffstat. Tab to a row with the keyboard: confirm the same tooltip appears on focus. Press Escape: confirm it disappears. Scroll the grid while a tooltip is showing: confirm it disappears rather than floating away from its row. Hover the pinned Working Changes row: confirm its tooltip shows the per-status badges instead of a commit message.
