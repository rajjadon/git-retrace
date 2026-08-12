# Author ownership — per-file heatmap — design

**Status:** Approved for planning
**Roadmap item:** GitLore CLAUDE.md §7, Phase 2 (last remaining item) — "Author ownership — per-file heatmap: who owns which regions, by line count and recency"

## Problem

GitLore already answers "who wrote this line and why" (blame decoration, hover, AI line explanation) and "is this code stale" (the CodeLens from the previous sub-project). It doesn't yet answer, at a glance, "who actually owns this file overall, and which parts are whose" — useful before touching unfamiliar code, or deciding who to ask about it.

## Scope

1. A color mark in the editor's **overview ruler** (the strip on the right edge VS Code's own git/search/error decorations already use) for every committed line, colored by that line's blame author.
2. A new command, `gitLore.showFileOwnership`, that opens a native `vscode.window.showQuickPick` listing each author, their recency-weighted ownership percentage, and how long ago they were last active on the file.

Both reuse the existing `BlameSource` cache entirely — no new git-fetching path. New code lives in `src/core/git/ownership.ts` (pure), `src/utils/colors.ts` (new, shared — see "Shared color palette" below), `src/providers/OwnershipDecorationProvider.ts` (new), and a new command handler. `CommitGraph/render.ts` is lightly refactored to consume the shared palette instead of its own local copy.

## Per-line color: the "heatmap"

Each line's ruler color is a **direct, objective mapping**: whichever author git blame currently attributes that line to, get their (stable) color. There is no weighting or decay at this level — git blame already attributes exactly one author per line, so there's no ambiguity to resolve.

**Uncommitted lines get no ruler mark.** They have no settled author in the sense this feature cares about (`BlameLine.isUncommitted`), so they're skipped rather than assigned a placeholder color — avoids inventing a new visual state for a case the feature doesn't need to cover.

**Stable color assignment.** The same author must get the same color every time, in every file, in this repo session — otherwise the mental model ("blue = Alice") breaks the moment you open a second file. Colors come from VS Code's own categorical palette (`--vscode-charts-blue/orange/green/purple/red/yellow/foreground`) — the exact same 7-color set `CommitGraph`'s lane coloring already uses, picked via a stable hash of the author's email mod 7. With more than 7 distinct authors in a file, colors repeat (accepted limitation — `CommitGraph`'s lane coloring already accepts the identical limitation for lane count, so this isn't a new class of trade-off for the codebase).

**Ruler lane.** `vscode.OverviewRulerLane.Full` — VS Code's built-in git-change indicators use `Left`, find-match highlights use `Center`, and diagnostics typically render on `Right`; using `Full` keeps the ownership mark visually distinct from all three rather than competing with git's own change indicators specifically.

### Shared color palette (small refactor)

`CommitGraph/render.ts` currently defines `LANE_COLOR_VARS` (a 7-string array of CSS custom property names) and a local `laneColor(lane: number): string` helper. This feature needs the *same* stable palette in a second, different representation: `OwnershipDecorationProvider` sets `overviewRulerColor` on a native `vscode.TextEditorDecorationType`, whose type is `string | vscode.ThemeColor` (verified against `@types/vscode`) — a webview-only `var(--vscode-charts-blue)` CSS reference is meaningless there; it needs an actual `new vscode.ThemeColor('charts.blue')`. So the shared palette's canonical form is the dot-form theme color id, with two small derivations — one CSS-var string (for the webview), one raw id string (for constructing a `ThemeColor`, kept as a plain string so this file stays `vscode`-import-free). New `src/utils/colors.ts`:

```ts
export const CHART_THEME_COLOR_IDS = [
  'charts.blue',
  'charts.orange',
  'charts.green',
  'charts.purple',
  'charts.red',
  'charts.yellow',
  'charts.foreground',
];

function idForIndex(index: number): string {
  return CHART_THEME_COLOR_IDS[index % CHART_THEME_COLOR_IDS.length] ?? CHART_THEME_COLOR_IDS[0] ?? 'charts.foreground';
}

/** CSS custom property reference for a webview stylesheet, e.g. `var(--vscode-charts-blue)`. */
export function chartCssVarForIndex(index: number): string {
  return `var(--vscode-${idForIndex(index).replace('.', '-')})`;
}

/** VS Code theme color id, for `new vscode.ThemeColor(...)` — callers construct the actual ThemeColor; this file has zero `vscode` imports. */
export function chartThemeColorIdForIndex(index: number): string {
  return idForIndex(index);
}
```

`CommitGraph/render.ts`'s `laneColor` becomes a thin call to `chartCssVarForIndex`; its local `LANE_COLOR_VARS` array is deleted. `core/git/ownership.ts` uses `CHART_THEME_COLOR_IDS.length` to compute a stable per-author index (see below) — `utils/colors.ts` has zero `vscode` imports (same as every other file in `utils/`), so `core/` importing from it does not violate the "zero `vscode` imports in `core/`" rule. `OwnershipDecorationProvider` uses `chartThemeColorIdForIndex` to build the actual `ThemeColor`.

## Recency-weighted ownership (the legend's ranking)

This is where "line count and recency" combines into one score. For each line, its contribution to its author's score decays exponentially by the age of the commit that touched it:

```
weight(ageDays) = 0.5 ^ (ageDays / 180)
```

A line touched today contributes ~1.0; a line touched 180 days ago contributes ~0.5; a line touched 3 years ago contributes a small but non-zero amount. Each author's score is the sum of `weight(ageDays)` over every line currently attributed to them (uncommitted lines excluded, same as the ruler). Percentages are each author's score divided by the sum of all authors' scores.

180 days is a hardcoded internal constant for v1 (`OWNERSHIP_HALF_LIFE_DAYS`), not a new setting — this feature is opt-in already (see Settings below); a second knob for tuning the decay curve isn't justified until someone actually asks for it.

This scoring only feeds the **QuickPick's ranking and percentages** — it has no effect on the ruler's per-line color, which stays a direct blame lookup.

## The legend: `gitLore.showFileOwnership` command

Opens `vscode.window.showQuickPick` with one item per author, newest-active first:

```
Alice Dev                                    62%
14 lines · last active 2 days ago

Bob Smith                                    38%
9 lines · last active 3 months ago
```

(`label` = author name, `description` = rounded percentage, `detail` = line count + last-active age — `QuickPickItem`'s three built-in fields, no custom rendering needed.)

**Correction found while writing the implementation plan:** the original design here called for a colored icon swatch matching each author's ruler color. Checked against `@types/vscode`: `ThemeIcon`'s `color` parameter is documented as *"currently only used in `TreeItem`"* — it has no effect when a `ThemeIcon` is used as a `QuickPickItem.iconPath`, so the swatch would silently render in the default foreground color, not the intended per-author color. Rather than switch to a `TreeView` (a bigger UI surface than a QuickPick, for a v1) or hand-generate theme-reactive SVG icons (real complexity for a cosmetic detail), the swatch is dropped — the ruler is still the actual visual heatmap; this list is a plain textual ranking. No loss of the feature's core value ("who owns this file, by recency-weighted percentage"), just the color-matching flourish.

Read-only — selecting an item does nothing further, per the "informational list" decision; no new webview or panel.

Command title: `GitLore: Show File Ownership` (namespaced per existing convention). No title-bar icon on an editor tab needed for v1 — command-palette-only, matching how `gitLore.copySha` and similar single-purpose commands are already command-palette/context-menu-only rather than always-visible buttons.

## Wiring and lifecycle

`OwnershipDecorationProvider` mirrors `BlameDecorationProvider`'s existing lifecycle:
- Recomputes on `vscode.window.onDidChangeActiveTextEditor`.
- Re-renders on `BlameSource.onInvalidate` (a commit, branch switch, or file change invalidates the cached blame this feature also reads).
- Skips files over `gitLore.maxBlameFileSize` (existing setting, existing guard pattern) and non-`file`-scheme documents.
- **Does not** recompute on cursor/selection movement — unlike inline blame (which re-renders per current line), ownership reflects the whole file's committed history, not the current cursor position, so there's nothing for a selection change to invalidate.

`gitLore.showFileOwnership`'s handler calls the same `BlameSource.getBlameLines` + `core/git/ownership.ts` aggregation the decoration provider uses, so the QuickPick and the ruler are always computed from the identical underlying data — they can't drift apart.

The command's logic is split for testability: a new `src/commands/ownershipCommands.ts` exports `buildOwnershipQuickPickItems(source: BlameSource, filePath: string, now?: Date): Promise<vscode.QuickPickItem[] | null>` (returns `null` when there's no blame data at all, so the command handler can show the informational message instead of an empty picker) — this function itself imports `vscode` (for `QuickPickItem`), so it lives in `commands/`, not `core/`, but it's directly callable and inspectable in a test without ever opening a real picker UI. The registered command handler (`handleShowFileOwnershipCommand`) is a thin wrapper: resolve the active editor's file, call `buildOwnershipQuickPickItems`, then either show the informational message or pass the result straight to `vscode.window.showQuickPick`.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `gitLore.ownership.enabled` | boolean | `false` | Show an overview-ruler color mark per line for that line's author. Opt-in — a more opinionated visual than inline blame. |

`gitLore.showFileOwnership` (the command) works regardless of this setting — you can ask "who owns this file" once without turning on the persistent ruler decoration.

## Error handling (per CLAUDE.md §13)

| Situation | Response |
|---|---|
| Not a git repo / blame fails | `BlameSource` already returns `null` silently (logs to output channel) — decoration provider clears any existing marks, command shows an informational message ("GitLore: no blame data for this file") |
| `gitLore.ownership.enabled` is `false` | Decoration provider does nothing; the command still works |
| File exceeds `maxBlameFileSize` | Skip, same as blame decorations |
| No commits at all (every line uncommitted) | Ruler shows no marks; command shows an informational message rather than an empty/confusing list |

## Testing

- **Unit** (`test/unit/core/git/ownership.test.ts`): the decay formula at known ages (0, 180, 360 days) against hand-computed expected weights; uncommitted lines excluded from both `computeOwnership` and `computeLineColors`; percentages sum to 100 (within floating-point tolerance) across a multi-author fixture; stable per-author color-index assignment via `computeLineColors`/the shared hash (same author email always yields the same index, regardless of how many other authors are present or their order).
- **Unit** (`test/unit/utils/colors.test.ts`): `chartCssVarForIndex` and `chartThemeColorIdForIndex` both cycle correctly past the palette's length (index 7 wraps to index 0), and agree with each other (index N's CSS var name and theme color id refer to the same underlying color).
- **Unit** (`test/unit/views/commitGraph.render.test.ts`): existing lane-color tests continue to pass unchanged after `CommitGraph/render.ts` is refactored to call `chartCssVarForIndex` — this is a refactor, not a behavior change, so no test should need new assertions, only continued passing ones.
- **Integration** (`test/integration/ownership.test.ts`): a fixture repo with commits from two authors at known dates —
  - produces the expected overview-ruler decoration ranges, exposed via a test-only hook on `GitLoreTestApi` (`getOwnershipRangesForTest`), matching the existing `getRenderedLabel`-style pattern `BlameDecorationProvider` already uses;
  - `buildOwnershipQuickPickItems` (called directly, not through the real interactive picker) returns items in the expected order (newest-active author first) with the expected labels/percentages/details.

## Out of scope for this spec

- Any change to how blame is fetched (fully reuses `BlameSource`).
- A settings knob for the half-life constant.
- Any click/selection action on the QuickPick's items.
- Per-region (multi-line block) granularity beyond per-line — the ruler mark is naturally per-line already, which is the finest granularity blame supports.
- File-level or repo-level ownership summaries beyond the single open file.
