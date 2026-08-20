# GitLore Webview Design System — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace VS Code theme-derived styling with GitLore's own fixed design-token system (dark-mode-first, teal/cyan signature accent, IBM Plex Sans + JetBrains Mono) in the foundation (`shared.css`) plus the two highest-visibility webviews — Commit Graph and Launchpad — while leaving native VS Code UI (blame decorations, hover cards, tree views, status bar) untouched and theme-derived exactly as before.

**Architecture:** GitLore already has a partial token abstraction (`--gitlore-accent`, `--gitlore-accent-gradient*`, `--gitlore-radius-*`, `--gitlore-motion` in `shared.css`'s `:root`) — this plan extends that existing pattern rather than replacing it: new `--gl-*` tokens for color/typography are added, the existing `--gitlore-accent*` variables are *repointed* from `var(--vscode-charts-purple/blue)` to the new fixed tokens (their definition site changes, not every call site), and `--gitlore-radius-*`/`--gitlore-motion` are left untouched (already fixed values, already match the target aesthetic). Every `var(--vscode-X)` reference in `shared.css`, `commitGraph.css`, and `launchpad.css` is replaced per the mapping table in Appendix A. `colors.ts`'s `chartCssVarForIndex` (webview lane/author coloring) is repointed to a new fixed categorical palette; `chartThemeColorIdForIndex` and `recencyGradientColorIdForBucket` (both feed native editor decorations — `OwnershipDecorationProvider`, `FullFileBlameDecorationProvider`) are explicitly **not** touched, since editor decorations stay theme-derived per the spec's scope boundary.

**Tech Stack:** Vanilla CSS custom properties, self-hosted web fonts (IBM Plex Sans, JetBrains Mono — both SIL Open Font License), no new npm dependency, no JS runtime theme-switching (`prefers-color-scheme` media queries handle light/dark natively in CSS).

**Spec:** `docs/superpowers/specs/2026-08-20-gitlore-webview-design-system.md`

## Global Constraints

- No hardcoded hex outside the `:root` token definitions in `shared.css` — every rule in every other file references a `--gl-*` (or existing `--gitlore-*`) custom property, never a literal color.
- Native VS Code UI is explicitly out of scope: `src/providers/OwnershipDecorationProvider.ts`, `src/providers/FullFileBlameDecorationProvider.ts`, `src/providers/BlameHoverProvider.ts`, `src/providers/BlameDecorationProvider.ts`, `src/providers/RepoExplorerProvider.ts`, `src/providers/FileHistoryProvider.ts`, `src/providers/StatusBarProvider.ts` — none of these are touched by this plan.
- Literal file/diff content (a diff hunk, a file path) keeps `var(--vscode-editor-font-family)`/`var(--vscode-editor-font-size)` — only UI chrome and code-*shaped identifiers* (SHAs, branch/tag/repo names) move to `--gl-font-mono`.
- No new runtime dependency; font files are static assets under `media/fonts/`, bundled with the extension (not loaded from a CDN — GitLore's CSP already forbids that at runtime).
- This plan covers `shared.css` + `commitGraph.css` + `launchpad.css` only. The remaining five webviews (Branch Comparison, Commit Details, PR Details, Rebase Editor, Visual File History, Chat — six, not five, corrected: Visual File History too) still use the old `--vscode-*`-derived styling after this plan lands; that's a deliberate, separate Phase 2, not an oversight. `shared.css`'s foundation change means those six webviews still render correctly in the meantime — they just don't yet reflect the new identity.

---

## File Structure

- Create: `media/fonts/ibm-plex-sans-{400,500,600}.woff2`, `media/fonts/jetbrains-mono-{400,500}.woff2`
- Modify: `media/shared.css` — new `@font-face` rules, new `:root` tokens, migrate existing rules
- Modify: `media/commitGraph.css` — migrate rules, ref-badge categorical colors
- Modify: `media/launchpad.css` — migrate rules, reconcile per-bucket accent CSS with new semantic/brand tokens
- Modify: `src/utils/colors.ts` — new categorical palette, repoint `chartCssVarForIndex` only
- Modify: `CLAUDE.md` — §18 scoping clauses, §6 note
- Modify: `CHANGELOG.md`

---

### Task 1: Bundle the two typefaces

**Files:**
- Create: `media/fonts/ibm-plex-sans-400.woff2`, `media/fonts/ibm-plex-sans-500.woff2`, `media/fonts/ibm-plex-sans-600.woff2`
- Create: `media/fonts/jetbrains-mono-400.woff2`, `media/fonts/jetbrains-mono-500.woff2`
- Modify: `media/shared.css`

**Interfaces:**
- Produces: `@font-face` rules for `'IBM Plex Sans'` (400/500/600) and `'JetBrains Mono'` (400/500), referenced by later tasks as `var(--gl-font-ui)`/`var(--gl-font-mono)`.

- [ ] **Step 1: Download the font files**

Google Fonts serves static `.woff2` files at stable URLs. Fetch exactly these five (weight-specific, not variable-font — keeps the bundle small per the §12 performance budget):

```bash
mkdir -p media/fonts
curl -sL "https://fonts.gstatic.com/s/ibmplexsans/v19/zYX9KVElMYYaJe8bpLHnCwDKhdTk3j775rSY6xwlmA.woff2" -o media/fonts/ibm-plex-sans-400.woff2
curl -sL "https://fonts.gstatic.com/s/ibmplexsans/v19/zYXgKVElMYYaJe8bpLHnCwDKjbLoLQnPPz1dqQdjmDrJ2gc.woff2" -o media/fonts/ibm-plex-sans-500.woff2
curl -sL "https://fonts.gstatic.com/s/ibmplexsans/v19/zYXgKVElMYYaJe8bpLHnCwDKjbLoLQnPPz1dqYFrmDrJ2gc.woff2" -o media/fonts/ibm-plex-sans-600.woff2
curl -sL "https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxTOlOV.woff2" -o media/fonts/jetbrains-mono-400.woff2
curl -sL "https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjOlOV.woff2" -o media/fonts/jetbrains-mono-500.woff2
```

**These exact URLs may have shifted** (Google Fonts versions its static file paths). Verify each downloaded file is a valid woff2 (starts with the `wOF2` magic bytes, not an HTML error page) — `file media/fonts/*.woff2` should report `Web Open Font Format (Version 2)` for all five. If any URL 404s, resolve the current one from `https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap` (fetch that stylesheet, read the actual `src: url(...)` lines it returns, use those URLs instead) — do not substitute a different font family if a URL is stale, just re-resolve it.

- [ ] **Step 2: Verify the files**

Run: `file media/fonts/*.woff2`
Expected: all five report `Web Open Font Format (Version 2)`.

- [ ] **Step 3: Add `@font-face` rules to `shared.css`**

At the very top of `media/shared.css`, before the existing `:root` block:

```css
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('./fonts/ibm-plex-sans-400.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('./fonts/ibm-plex-sans-500.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('./fonts/ibm-plex-sans-600.woff2') format('woff2');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./fonts/jetbrains-mono-400.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./fonts/jetbrains-mono-500.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
```

A relative `url('./fonts/...')` resolves correctly because every webview already links `shared.css` via `webview.asWebviewUri`, which VS Code serves from the extension's own `media/` root — the same reason `media/icon.svg`-style relative references already work elsewhere in this codebase. Confirm this assumption by checking how `styleUris` are constructed in one provider (e.g. `CommitGraphViewProvider.ts`'s `mediaUri` method) before relying on it — if webview CSP's `style-src`/`font-src` needs an explicit `font-src` entry added, add it in Task 1a below.

- [ ] **Step 3a: Check and fix webview CSP for font loading if needed**

Grep every provider's CSP meta tag construction (search `Content-Security-Policy` across `src/views/*/render.ts`). Each currently declares `style-src` and `img-src`; none currently declare `font-src`, which means the default (`default-src 'none'`) blocks the `@font-face` `url()` reference even though it's a local extension resource. Add `font-src ${opts.cspSource};` to every CSP meta tag in: `CommitGraph/render.ts`, `Launchpad/render.ts` (the two touched by this plan) — leave the other six's CSP alone for Phase 2, since they don't yet reference these fonts.

- [ ] **Step 4: Verify the fonts actually load**

There's no automated test for a font rendering correctly in a webview (this genuinely needs a visual check, not a fabricated assertion) — defer to this plan's final manual verification step (see bottom). Do not write a fake "test" that only checks the CSS text contains the font name; that would test the string, not the font loading, which is the only thing this step is actually about.

- [ ] **Step 5: Commit**

```bash
git add media/fonts media/shared.css src/views/CommitGraph/render.ts src/views/Launchpad/render.ts
git commit -m "feat(design): bundle IBM Plex Sans and JetBrains Mono"
```

---

### Task 2: New color/typography token system in `shared.css`

**Files:**
- Modify: `media/shared.css`

**Interfaces:**
- Produces: `--gl-bg`, `--gl-surface`, `--gl-surface-2`, `--gl-border`, `--gl-text`, `--gl-text-muted`, `--gl-accent-start`, `--gl-accent-end`, `--gl-accent-solid`, `--gl-accent-dim`, `--gl-on-accent`, `--gl-hover-bg`, `--gl-success`, `--gl-danger`, `--gl-warning`, `--gl-cat-1..6`, `--gl-font-ui`, `--gl-font-mono`, `--gl-text-xs/sm/base/md/lg` (all dark by default, light via `prefers-color-scheme: light`)
- Modifies: `--gitlore-accent`, `--gitlore-accent-gradient`, `--gitlore-accent-gradient-v`, `--gitlore-accent-gradient-diag`, `--gitlore-shadow-hover` — same names, new definitions (every existing call site keeps working unchanged)
- Leaves unchanged: `--gitlore-radius-sm/md/lg`, `--gitlore-motion`

- [ ] **Step 1: Replace the `:root` block**

In `media/shared.css`, replace the existing `:root { ... }` block (the one starting with `--gitlore-accent: var(--vscode-charts-purple);`) with:

```css
:root {
  /* ---- GitLore's own fixed design tokens (dark, default) ---- */
  --gl-bg: #0F172A;
  --gl-surface: #1B2336;
  --gl-surface-2: #1E293B;
  --gl-border: #2C3B57;
  --gl-text: #F8FAFC;
  --gl-text-muted: #94A3B8;
  --gl-accent-start: #2DD4BF;
  --gl-accent-end: #0891B2;
  --gl-accent-solid: #2DD4BF;
  --gl-accent-dim: #123B3B;
  --gl-on-accent: #062024;
  --gl-hover-bg: rgba(255, 255, 255, 0.04);
  --gl-success: #22C55E;
  --gl-danger: #EF4444;
  --gl-warning: #EAB308;
  --gl-cat-1: #3B82F6;
  --gl-cat-2: #F97316;
  --gl-cat-3: #A78BFA;
  --gl-cat-4: #F472B6;
  --gl-cat-5: #6366F1;
  --gl-cat-6: var(--gl-text-muted);
  --gl-font-ui: 'IBM Plex Sans', sans-serif;
  --gl-font-mono: 'JetBrains Mono', monospace;
  --gl-text-xs: 11px;
  --gl-text-sm: 12.5px;
  --gl-text-base: 13px;
  --gl-text-md: 14px;
  --gl-text-lg: 16px;

  /*
   * GitLore's signature accent — repointed from a theme-derived lookup (var(--vscode-charts-purple))
   * to the fixed tokens above. Every existing call site (section-head's left bar, panel header
   * underlines, the AI action, hover-card borders) keeps working unchanged — only this definition
   * moved.
   */
  --gitlore-accent: var(--gl-accent-solid);
  --gitlore-accent-gradient: linear-gradient(90deg, var(--gl-accent-start), var(--gl-accent-end));
  --gitlore-accent-gradient-v: linear-gradient(180deg, var(--gl-accent-start), var(--gl-accent-end));
  --gitlore-accent-gradient-diag: linear-gradient(135deg, var(--gl-accent-start), var(--gl-accent-end));
  --gitlore-radius-lg: 6px;
  --gitlore-radius-sm: 2px;
  --gitlore-radius-md: 3px;
  --gitlore-motion: 140ms ease-out;
  /* Fixed elevation, one level only — no longer theme-derived. */
  --gitlore-shadow-hover: 0 2px 6px rgba(0, 0, 0, 0.36);
}

@media (prefers-color-scheme: light) {
  :root {
    --gl-bg: #F8FAFC;
    --gl-surface: #FFFFFF;
    --gl-surface-2: #F1F5F9;
    --gl-border: #E2E8F0;
    --gl-text: #0F172A;
    --gl-text-muted: #64748B;
    --gl-accent-start: #0D9488;
    --gl-accent-end: #0E7490;
    --gl-accent-solid: #0D9488;
    --gl-accent-dim: #CCFBF1;
    --gl-on-accent: #062024;
    --gl-hover-bg: rgba(0, 0, 0, 0.03);
    --gitlore-shadow-hover: 0 2px 6px rgba(0, 0, 0, 0.06);
  }
}
```

- [ ] **Step 2: Verify no build breakage**

Run: `npm run compile`
Expected: clean — this step only redefines custom properties, no selector or markup changed yet, so nothing should visually break until Tasks 4-6 apply the new tokens.

- [ ] **Step 3: Commit**

```bash
git add media/shared.css
git commit -m "feat(design): add GitLore's own fixed design tokens, repoint signature accent"
```

---

### Task 3: Repoint the webview categorical palette (lane/author coloring)

**Files:**
- Modify: `src/utils/colors.ts`
- Test: `test/unit/utils/colors.test.ts` (create if it doesn't already exist — check first)

**Interfaces:**
- Produces: `WEBVIEW_CATEGORICAL_COLOR_VARS` (new export, array of `var(--gl-cat-N)` strings)
- Modifies: `chartCssVarForIndex(index: number): string` — same signature, now cycles through the new array instead of `CHART_THEME_COLOR_IDS`
- Does NOT modify: `chartThemeColorIdForIndex`, `recencyGradientColorIdForBucket`, `CHART_THEME_COLOR_IDS`, `RECENCY_GRADIENT_COLOR_IDS` — these feed `OwnershipDecorationProvider` and `FullFileBlameDecorationProvider` (native editor decorations), which stay theme-derived per the spec's explicit scope boundary.

- [ ] **Step 1: Check for an existing test file**

Run: `find test/unit -iname "*colors*"`. If `test/unit/utils/colors.test.ts` exists, read it first and add to it rather than creating a duplicate.

- [ ] **Step 2: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartCssVarForIndex, chartThemeColorIdForIndex } from '../../../src/utils/colors';

test('chartCssVarForIndex: cycles through the fixed webview categorical palette, not a VS Code theme lookup', () => {
  assert.equal(chartCssVarForIndex(0), 'var(--gl-cat-1)');
  assert.equal(chartCssVarForIndex(6), 'var(--gl-cat-1)'); // wraps
});

test('chartThemeColorIdForIndex is untouched — still a VS Code theme color id for editor decorations', () => {
  assert.equal(chartThemeColorIdForIndex(0), 'charts.blue');
});
```

(Adjust the import path to match this file's actual relative depth once you confirm where it lives.)

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `chartCssVarForIndex(0)` currently returns `var(--vscode-charts-blue)`.

- [ ] **Step 4: Implement**

In `src/utils/colors.ts`, add a new array and repoint only `chartCssVarForIndex`:

```typescript
/**
 * Fixed categorical palette for webview-rendered lane/author coloring (Commit Graph lanes, Visual
 * File History author lanes) — distinct from `CHART_THEME_COLOR_IDS` below, which feeds *native
 * editor decorations* (the ownership ruler) and must stay theme-derived. This one is fixed because
 * these eight webview panels no longer derive color from the user's VS Code theme at all.
 */
const WEBVIEW_CATEGORICAL_COLOR_VARS = [
  'var(--gl-cat-1)',
  'var(--gl-cat-2)',
  'var(--gl-cat-3)',
  'var(--gl-cat-4)',
  'var(--gl-cat-5)',
  'var(--gl-cat-6)',
];

/** CSS custom property reference for a webview stylesheet — cycles through GitLore's own fixed categorical palette. */
export function chartCssVarForIndex(index: number): string {
  return WEBVIEW_CATEGORICAL_COLOR_VARS[index % WEBVIEW_CATEGORICAL_COLOR_VARS.length] ?? WEBVIEW_CATEGORICAL_COLOR_VARS[0]!;
}
```

Remove the old `chartCssVarForIndex` body (the one calling `idForIndex(index).replace('.', '-')`) — `idForIndex`/`CHART_THEME_COLOR_IDS` stay, still used by `chartThemeColorIdForIndex`.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/colors.ts test/unit/utils/colors.test.ts
git commit -m "feat(design): repoint webview lane/author coloring to fixed categorical palette"
```

---

### Task 4: Migrate `shared.css` rules to the new tokens

**Files:**
- Modify: `media/shared.css`

**Interfaces:** None new — this task only changes values inside existing rules, no new classes/selectors.

- [ ] **Step 1: Apply the mapping table**

Using **Appendix A** at the bottom of this plan, replace every remaining `var(--vscode-X ...)` occurrence in `media/shared.css` with its mapped `--gl-*` token, **except** the two literal-content exceptions already identified: `.file-path`'s `font-family: var(--vscode-editor-font-family)` and `pre.diff`'s `font-family`/`font-size` — leave both of those exactly as they are (per the spec §5 rule: actual file/diff content still reads as the user's editor font).

Also add `font-family: var(--gl-font-ui); font-size: var(--gl-text-base);` to `body` (or the top-level container rule) if `shared.css` doesn't already set a base font — check first; if every view's own CSS sets its own body font today, add it once here instead, and remove the now-redundant per-view declaration in Tasks 5-6.

- [ ] **Step 2: Verify no remaining unintended `--vscode-` references**

Run:
```bash
grep -n "var(--vscode-" media/shared.css
```
Expected output: exactly the two literal-content exceptions (`.file-path`'s and `pre.diff`'s `font-family`, plus `pre.diff`'s `font-size`) — three lines total. Anything else means a rule was missed; go back and map it per Appendix A.

- [ ] **Step 3: Run the full unit suite and lint**

Run: `npm run test:unit && npm run lint`
Expected: PASS — no CSS is under test directly, but this confirms nothing else regressed (e.g. a `render.ts` unit test asserting on inline styles that referenced a now-renamed token, if any exist — check `grep -rn "vscode-charts\|vscode-gitDecoration" test/unit/views/` first and update any that assert on the old variable names).

- [ ] **Step 4: Commit**

```bash
git add media/shared.css
git commit -m "feat(design): migrate shared.css from VS Code theme tokens to GitLore's own"
```

---

### Task 5: Migrate `commitGraph.css`

**Files:**
- Modify: `media/commitGraph.css`

- [ ] **Step 1: Apply the mapping table, plus these three commit-graph-specific resolutions**

Using Appendix A for the generic entries, additionally:
- `.cell-sha code`'s `font-family: var(--vscode-editor-font-family)` → `var(--gl-font-mono)` (a SHA is an identifier, not file content — per spec §3.4/§5 distinction, this one **does** change, unlike `.file-path`).
- `.ref-tag`'s `var(--vscode-charts-yellow)` → `var(--gl-cat-2)` (a warm hue, closest available to the original intent without reusing `--gl-warning`, which would incorrectly imply "something's wrong with this tag").
- `.ref-detached`'s `var(--vscode-charts-orange)` → `var(--gl-cat-4)`.
- `.ref-stash`'s `var(--vscode-charts-purple, ...)` → `var(--gl-cat-3)` (closest available hue to the original purple intent).

- [ ] **Step 2: Verify no remaining unintended `--vscode-` references**

Run: `grep -n "var(--vscode-" media/commitGraph.css`
Expected: no output at all (commit graph has no literal-file-content exception — `.cell-sha` was the only font-family reference, and it's explicitly repointed above).

- [ ] **Step 3: Run the render unit tests**

Run: `npm run test:unit`
Expected: PASS. If `test/unit/views/commitGraph.render.test.ts` asserts on any literal `--vscode-` string in rendered HTML (check via `grep -n "vscode-charts\|vscode-gitDecoration" test/unit/views/commitGraph.render.test.ts`), update those assertions to the new token names first.

- [ ] **Step 4: Commit**

```bash
git add media/commitGraph.css
git commit -m "feat(design): migrate commitGraph.css to GitLore's own design tokens"
```

---

### Task 6: Migrate `launchpad.css`, reconcile per-bucket accent colors

**Files:**
- Modify: `media/launchpad.css`

- [ ] **Step 1: Apply the mapping table, plus reconcile the per-bucket column accent rules added in the recent UI-polish pass**

Using Appendix A for the generic entries, then replace the four `data-bucket` accent rules (added in `feat(launchpad): add a per-bucket column accent color`) with:

```css
.column[data-bucket='needsReview'] .column-head {
  border-left: 3px solid transparent;
  border-image: var(--gitlore-accent-gradient-v) 1;
}

.column[data-bucket='readyToMerge'] .column-head {
  border-left: 3px solid var(--gl-success);
}

.column[data-bucket='blocked'] .column-head {
  border-left: 3px solid var(--gl-danger);
}

.column[data-bucket='waiting'] .column-head {
  border-left: 3px solid var(--gl-warning);
}
```

`needsReview` gets the signature gradient (per spec §3.1's gradient-usage rule: "the thing most likely to need your attention right now," matching the approved mockup) via `border-image` — a `border-left` alone can't render a gradient; `border-image` with `1` as the slice value is the standard way to put a gradient on a single border edge. The other three buckets keep flat semantic colors, matching the approved mockup exactly (only one column got the special gradient treatment).

- [ ] **Step 2: Verify no remaining unintended `--vscode-` references**

Run: `grep -n "var(--vscode-" media/launchpad.css`
Expected: no output.

- [ ] **Step 3: Run the render unit tests**

Run: `npm run test:unit`
Expected: PASS. Check `test/unit/views/launchpad.render.test.ts` for any assertion on the old `--vscode-charts-*` bucket-accent CSS (added in the UI-polish pass) — those were CSS-only, not markup, so the existing render tests likely don't assert on this file's contents at all; confirm rather than assume.

- [ ] **Step 4: Commit**

```bash
git add media/launchpad.css
git commit -m "feat(design): migrate launchpad.css to GitLore's own design tokens, gradient accent on Needs Review"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `/Users/rajjadon/gitlore/CLAUDE.md`

- [ ] **Step 1: Add the scoping clause to §18**

Find the line: `- Blame decorations must meet contrast in both light and dark themes — derive colors from ThemeColor, never hardcode hex.` Add immediately after it:

```markdown
- This rule governs editor decorations, hover cards, tree items, and the status bar (native VS Code UI GitLore doesn't control the rendering of). It does **not** govern the eight webview panels (Commit Graph, Commit Details, Branch Comparison, PR Details, Rebase Editor, Visual File History, Launchpad, Chat) — those use GitLore's own fixed design-token palette (`media/shared.css`'s `:root`), not `ThemeColor`, as of the 2026-08-20 design system change. See `docs/superpowers/specs/2026-08-20-gitlore-webview-design-system.md`.
```

Find the line: `- Honor the user's editor.fontFamily inside webviews where it reads as editor content.` Add immediately after it:

```markdown
- "Reads as editor content" is the operative scope: a diff hunk, a file path, a commit's full patch — literal file/diff content — still honors `editor.fontFamily`/`editor.fontSize`. UI chrome and code-*shaped identifiers* (a SHA, a branch/tag/repo name) use GitLore's own `--gl-font-ui`/`--gl-font-mono` instead, regardless of the user's editor font.
```

- [ ] **Step 2: Add the font-bundling note to §6**

In the dependencies table's surrounding prose (or add a line after the table), note: `media/fonts/` bundles IBM Plex Sans and JetBrains Mono (both SIL Open Font License) as static assets — not an npm dependency, but worth noting as a new bundled-asset category.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: scope the ThemeColor/editor-font rules to exclude the new webview design system"
```

---

### Task 8: Update CHANGELOG, final verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the changelog entry**

```markdown
- **Commit Graph and Launchpad now use GitLore's own design system** — dark-mode-first (with a designed light counterpart), IBM Plex Sans + JetBrains Mono, a teal-to-cyan signature accent, instead of deriving every color from your VS Code theme. Editor decorations, hover cards, tree views, and the status bar are unaffected — they still adapt to your theme exactly as before. The other five docked panels (Branch Comparison, Commit/PR Details, Rebase Editor, Visual File History, Chat) haven't been migrated yet — that's a separate follow-up.
```

- [ ] **Step 2: Full verification**

Run, in order: `npm run lint`, `npm run compile`, `npm run test:unit`, `npm run test:integration`.
Expected: all clean/passing.

- [ ] **Step 2a: Contrast audit (spec §4 requirement — not yet verified by anything above)**

Compute the contrast ratio for every text/background pairing in both palettes using the WCAG formula (or any contrast-checker tool/library available). Minimum required: 4.5:1 for body text, 3:1 for large text (≥18px or ≥14px bold) and UI components (borders, icons conveying state). Check at minimum:
- `--gl-text` on `--gl-bg` and on `--gl-surface`/`--gl-surface-2` (both palettes)
- `--gl-text-muted` on `--gl-bg` and on `--gl-surface`/`--gl-surface-2` (both palettes) — this is the one most likely to fail, since muted text is deliberately lower-contrast
- `--gl-on-accent` on `--gl-accent-solid` (both palettes)
- `--gl-success`/`--gl-danger`/`--gl-warning` on `--gl-surface`/`--gl-surface-2` (both palettes)

Record the actual computed ratios in the PR description or a comment in this plan file. Any pairing under its required minimum needs an adjusted hex value (darken/lighten as needed) before this task is considered done — do not ship a documented-but-unverified assumption.

**Computed results (2026-08-20, WCAG relative-luminance formula, script-verified):**

Dark palette — all pass as originally specified, no changes:
| Pairing | Ratio | Min | Result |
|---|---|---|---|
| `--gl-text` / `--gl-bg` | 17.06:1 | 4.5:1 | PASS |
| `--gl-text` / `--gl-surface` | 14.98:1 | 4.5:1 | PASS |
| `--gl-text` / `--gl-surface-2` | 13.98:1 | 4.5:1 | PASS |
| `--gl-text-muted` / `--gl-bg` | 6.96:1 | 4.5:1 | PASS |
| `--gl-text-muted` / `--gl-surface` | 6.11:1 | 4.5:1 | PASS |
| `--gl-text-muted` / `--gl-surface-2` | 5.71:1 | 4.5:1 | PASS |
| `--gl-on-accent` / `--gl-accent-solid` | 9.10:1 | 4.5:1 | PASS |
| `--gl-success` / `--gl-surface` | 6.88:1 | 3:1 | PASS |
| `--gl-success` / `--gl-surface-2` | 6.42:1 | 3:1 | PASS |
| `--gl-danger` / `--gl-surface` | 4.16:1 | 3:1 | PASS |
| `--gl-danger` / `--gl-surface-2` | 3.89:1 | 3:1 | PASS |
| `--gl-warning` / `--gl-surface` | 8.17:1 | 3:1 | PASS |
| `--gl-warning` / `--gl-surface-2` | 7.63:1 | 3:1 | PASS |

Light palette — three pairings failed as originally specified and required a hex adjustment:
| Pairing | Original ratio | Result | Adjusted hex | New ratio |
|---|---|---|---|---|
| `--gl-text` / `--gl-bg` | 17.06:1 | PASS | — | — |
| `--gl-text` / `--gl-surface` | 17.85:1 | PASS | — | — |
| `--gl-text` / `--gl-surface-2` | 16.30:1 | PASS | — | — |
| `--gl-text-muted` / `--gl-bg` | 4.55:1 | PASS | — | — |
| `--gl-text-muted` / `--gl-surface` | 4.76:1 | PASS | — | — |
| `--gl-text-muted` / `--gl-surface-2` | **4.34:1** | **FAIL** (needed 4.5:1) | `#64748B` → `#606F85` | 4.66:1 |
| `--gl-on-accent` / `--gl-accent-solid` | 4.52:1 | PASS (thin margin) | — | — |
| `--gl-success` / `--gl-surface` | **2.28:1** | **FAIL** (needed 3:1) | `#22C55E` → `#16A34A` | 3.30:1 |
| `--gl-success` / `--gl-surface-2` | **2.08:1** | **FAIL** (needed 3:1) | `#22C55E` → `#16A34A` | 3.01:1 |
| `--gl-danger` / `--gl-surface` | 3.76:1 | PASS | — | — |
| `--gl-danger` / `--gl-surface-2` | 3.44:1 | PASS | — | — |
| `--gl-warning` / `--gl-surface` | **1.92:1** | **FAIL** (needed 3:1) | `#EAB308` → `#B45309` | 5.02:1 |
| `--gl-warning` / `--gl-surface-2` | **1.75:1** | **FAIL** (needed 3:1) | `#EAB308` → `#B45309` | 4.58:1 |

`--gl-text-muted` (light) changing from `#64748B` to `#606F85` also lifted its `--gl-bg`/`--gl-surface` ratios to 4.88/5.11 — still comfortably over 4.5:1. Dark-palette `--gl-success`/`--gl-warning` are unchanged (`#22C55E`/`#EAB308`) since only the light palette failed — this is a per-palette override, not a global token rename. Applied in `media/shared.css`'s `@media (prefers-color-scheme: light)` block with an inline comment recording the audit and the before/after values.

- [ ] **Step 3: Manual visual verification (F5)**

Open the Extension Development Host. Confirm:
- Commit Graph and Launchpad render in the new dark palette (near-black background, slate cards, teal/cyan accent) — not the old theme-derived look.
- Both fonts actually render (IBM Plex Sans for labels/titles, JetBrains Mono for SHAs) — inspect via DevTools' computed font-family if visually ambiguous.
- Switch VS Code to a light theme and confirm Commit Graph/Launchpad **do not** follow it (they should still be dark, since GitLore's own dark/light now follows OS `prefers-color-scheme`, not the VS Code theme) — then toggle the OS-level appearance (macOS: System Settings → Appearance) and confirm they **do** switch between the designed dark/light palettes.
- Launchpad's Needs Review column shows the gradient accent; Ready to Merge/Blocked/Waiting show flat green/red/yellow.
- The other six webviews (Branch Comparison, Commit Details, PR Details, Rebase Editor, Visual File History, Chat) still look exactly as before — unaffected, as intended for this phase.
- Confirm blame decorations, the hover card, Sidebar Explorer, and the status bar are visually unchanged (still following your VS Code theme).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for the webview design system, phase 1"
```

---

## Appendix A — `var(--vscode-X)` → GitLore token mapping

Apply exactly this mapping wherever a token below appears in `shared.css`/`commitGraph.css`/`launchpad.css`, except the literal-content exceptions called out in Tasks 4-5.

| VS Code token | GitLore token |
|---|---|
| `--vscode-panel-border`, `--vscode-widget-border`, `--vscode-input-border`, `--vscode-dropdown-border`, `--vscode-editorHoverWidget-border`, `--vscode-menu-border`, `--vscode-menu-separatorBackground` | `--gl-border` |
| `--vscode-focusBorder`, `--vscode-textLink-foreground`, `--vscode-inputOption-activeBorder` | `--gl-accent-solid` |
| `--vscode-descriptionForeground`, `--vscode-input-placeholderForeground`, `--vscode-badge-foreground` | `--gl-text-muted` |
| `--vscode-input-background`, `--vscode-dropdown-background`, `--vscode-textCodeBlock-background`, `--vscode-badge-background`, `--vscode-list-inactiveSelectionBackground` | `--gl-surface-2` |
| `--vscode-list-hoverBackground`, `--vscode-toolbar-hoverBackground` | `--gl-hover-bg` |
| `--vscode-gitDecoration-deletedResourceForeground`, `--vscode-errorForeground` | `--gl-danger` |
| `--vscode-gitDecoration-addedResourceForeground` | `--gl-success` |
| `--vscode-gitDecoration-modifiedResourceForeground` | `--gl-warning` |
| `--vscode-diffEditor-removedTextBackground` | `rgba(239, 68, 68, 0.12)` (fixed tint of `--gl-danger`) |
| `--vscode-diffEditor-insertedTextBackground` | `rgba(34, 197, 94, 0.12)` (fixed tint of `--gl-success`) |
| `--vscode-inputOption-activeForeground`, `--vscode-inputOption-activeBackground`, `--vscode-list-activeSelectionBackground`, `--vscode-menu-selectionBackground` | `--gl-accent-dim` (background role) — for the two *foreground* entries in this group (`inputOption-activeForeground`, and any active-selection *text* color), use `--gl-text` instead; check each occurrence's property (`background`/`background-color` vs `color`) before applying |
| `--vscode-editorHoverWidget-background`, `--vscode-menu-background` | `--gl-surface` |
| `--vscode-editorHoverWidget-foreground`, `--vscode-dropdown-foreground`, `--vscode-input-foreground`, `--vscode-menu-foreground`, `--vscode-menu-selectionForeground`, `--vscode-list-activeSelectionForeground`, `--vscode-foreground` | `--gl-text` |
| `--vscode-button-secondaryBackground` | `--gl-surface-2` |
| `--vscode-button-secondaryForeground` | `--gl-text` |
| `--vscode-button-secondaryHoverBackground` | `--gl-surface` |
| `--vscode-button-foreground` | `--gl-on-accent` |
| `--vscode-widget-shadow` | (already handled — `--gitlore-shadow-hover` in Task 2 is now a fixed value, not theme-derived) |
| `--vscode-panel-background`, `--vscode-editor-background`, `--vscode-sideBar-background` | `--gl-bg` |
| `--vscode-font-family` | `--gl-font-ui` |
| `--vscode-font-size` | `--gl-text-base` |
| `--vscode-charts-purple`, `--vscode-charts-blue` (where used as the *signature accent*, i.e. inside `--gitlore-accent*` — already handled in Task 2) | n/a, already repointed |
| `--vscode-charts-yellow`, `--vscode-charts-orange` (commit-graph ref badges) | see Task 5 Step 1's specific resolutions — not this generic table |
| `--vscode-charts-red` (Launchpad per-bucket, if present as a literal token rather than already `--gl-danger`) | `--gl-danger` |
| `--vscode-charts-green` (Launchpad per-bucket) | `--gl-success` |

**Before marking Tasks 4-6 done, `grep -n "var(--vscode-" <file>` must return only the explicitly-documented exceptions in that task's own steps — zero unexplained remaining references.**
