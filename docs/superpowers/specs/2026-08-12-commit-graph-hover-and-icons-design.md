# Commit Graph: row hover tooltip + icon-only headers — design

**Status:** Approved for planning
**Origin:** User reviewed a competing extension's actual Pro UI (a VS Code panel screenshot) and asked for GitLore's Commit Graph to close the gap. After flagging that the screenshot includes Pro-tier/paywalled features that conflict with GitLore's "fully free, minimal surface" mission (CLAUDE.md §1, §4, §20), the user narrowed scope to two concrete, license-clean UX gaps. A third candidate — a mini history-overview sparkline for scroll position — was explicitly cut: GitLore's graph loads a bounded, fully-rendered list (`gitLore.maxGraphItems`, default 200) rather than a virtualized/paginated one, so a scroll-position minimap doesn't solve a problem GitLore currently has.

## Scope

1. A rich hover/focus tooltip on Commit Graph rows (and the pinned Working Changes row), consolidating information already present in the row into one cohesive, immediately-appearing, consistently-styled popup — replacing reliance on several separate native browser `title` tooltips (slow, ~1s delay, unstyled, one per cell).
2. Icon-only column headers for Author, Changes, Commit Date, and SHA — "Branch / Tag" and "Commit Message" stay as text.

Both are presentation-only changes scoped to `src/views/CommitGraph/render.ts`, `media/commitGraph.css`, and `src/views/icons.ts`. No provider, service, or `core/` changes; no new settings; no new commands.

## 1. Row hover/focus tooltip

### Why a custom tooltip, not `vscode.Hover`

VS Code's `vscode.languages.registerHoverProvider` API (already used for GitLore's blame hover) only applies to `TextDocument`s open in editors — it has no effect inside a webview, which is what the Commit Graph is. The only way to show a rich hover inside this webview is a webview-native DOM/CSS tooltip built into `render.ts`'s inline script, the same way the file-filter box and keyboard navigation are already implemented there.

### Data source: read the DOM, don't add a data path

Every value the tooltip needs is already rendered somewhere in the row, just spread across separate cells and native `title` attributes:

| Tooltip field | Already available at |
|---|---|
| Full (untruncated) commit message | `.cell-message`'s `title` attribute |
| Author name | `.cell-author`'s text content |
| Absolute date | `.cell-date`'s `title` attribute (visible text is the relative age) |
| Diffstat (`N files, +ins −del`, or the merge-commit caveat) | `.cell-changes`'s `title` attribute (`statTitle`, already computed in `render.ts`) |
| Short SHA | `.cell-sha code`'s text content |
| Avatar URL | the `<image href="...">` element inside that row's own graph SVG (`.cell-graph svg image`) |

The tooltip's show-handler reads these directly from the hovered/focused row's own subtree at trigger time. This means **no new data flows from `renderGraphHtml`/the extension side** — the tooltip is purely a client-side presentation layer over data that's already there. Nothing can drift out of sync between what the row shows and what the tooltip shows, because they're the same underlying values.

The pinned Working Changes row has no commit message/SHA/diffstat in the same shape — its tooltip instead reads the per-status badges already rendered in its own `.cell-changes` (the `+N`/`~N`/`−N` spans from `renderWorkingChangeBadges`) and shows a short "Uncommitted changes — open Source Control" line instead of a message.

### Content layout

Mirrors the visual grammar GitLore's native blame hover already established (this session's earlier hover-card work), so the two don't read as different UI languages:

```
[avatar] **Author Name**

<full commit message>

<age> · <absolute date> · <sha>
<N files, +ins −del>   (or the merge-commit caveat text)
```

### Trigger and lifecycle

- Shows on `mouseenter` of a `.row.commit` / `.row.wip` element, and on `focus` of the same (rows already carry the roving-tabindex pattern used for keyboard navigation) — a mouse-only tooltip would hide this information from keyboard users entirely, which the rest of GitLore's UI (focus-visible outlines throughout) doesn't do.
- Hides on `mouseleave`/`blur`, on `Escape`, and on scroll of the `.grid` container — a floating tooltip that survives a scroll would visually detach from the row it describes.
- One shared tooltip `<div>` is reused across all rows (populated and repositioned per trigger), not one element per row — keeps the DOM small regardless of row count.
- Positioning: anchored below the triggering row by default, flipped above it if there isn't enough vertical room (the graph panel is often short, ~250px, per `commitGraph.css`'s own layout comments), and clamped horizontally so it never overflows the panel's right edge.

### Styling

Uses `--vscode-editorHoverWidget-background`, `--vscode-editorHoverWidget-border`, and `--vscode-editorHoverWidget-foreground` — the exact tokens VS Code's own native hover widget uses (confirmed against VS Code's bundled `workbench.desktop.main.css` during this session's earlier hover investigation). The custom tooltip therefore looks like a first-party VS Code hover rather than a bespoke one, with zero new color decisions to make.

### Accessibility

- Focus-triggered tooltips are the primary a11y mechanism (see Trigger above) — this isn't optional/decorative, it's how keyboard users get the same information mouse users get.
- The tooltip container carries `aria-hidden="true"`: every field it shows is already announced from the row's own cells on focus, so the tooltip adds nothing a screen reader needs — its value is purely visual, for sighted keyboard/mouse users. But showing it on focus, not just hover, is still required per above, so sighted keyboard users get the same visual payoff as mouse users.
- Respects `prefers-reduced-motion` (no motion is planned for showing/hiding it — an instant show/hide, not a fade — so this is satisfied by construction, not by adding a media query).

## 2. Icon-only column headers

| Column | Before | After |
|---|---|---|
| Branch / Tag | text | unchanged (text) |
| Graph | text | unchanged (text — already a short label) |
| Commit Message | text | unchanged (text — the central column) |
| Author | text | icon (new `AUTHOR_ICON`) |
| Changes | text | icon (reuses existing `FILE_COUNT_ICON`, previewing the same icon already shown in that column's cells) |
| Commit Date | text | icon (new `CLOCK_ICON`) |
| SHA | text | icon (new `HASH_ICON`) |

Three new icons (`AUTHOR_ICON`, `CLOCK_ICON`, `HASH_ICON`) are added to `src/views/icons.ts` following the file's existing pattern (`icon(pathBody, className, size)`, `currentColor`-stroked 16×16 viewBox SVGs, no icon-font dependency). None of the existing icons (`TAG_ICON`, `COPY_ICON`, etc.) represent "commit hash" without being misleading, so a dedicated glyph (a simple `#`-mark or short hash-tally shape) is added rather than reusing an ill-fitting one.

Every icon-only header keeps its real column name as a `title` and `aria-label` on the header cell, so `role="columnheader"` still announces "Author"/"Changes"/"Commit Date"/"SHA" to a screen reader even though the visible content is just a glyph — converting to an icon must not regress accessibility.

## Testing

- **Unit** (`test/unit/views/commitGraph.render.test.ts`): the shared tooltip container exists in the rendered HTML exactly once; hover/focus/blur/scroll/Escape event wiring is present in the embedded script; icon-only headers (Author/Changes/Commit Date/SHA) carry the correct `title`/`aria-label` while their visible content is an icon, not text; Branch/Tag, Graph, and Commit Message headers are unchanged (still plain text, no icon).
- No integration test is added specifically for this — it's a presentation-only change with no new provider/message-passing behavior, and the existing `test/integration/commitGraph.test.ts` suite already exercises the panel end-to-end without needing to simulate hover/focus interactions inside a headless webview (which VS Code's test harness doesn't make practical to script reliably).

## Out of scope

- The mini history-overview sparkline (explicitly cut — see Origin above).
- Any change to what data the Commit Graph fetches or how many commits it loads.
- Any AI, natural-language search, "Compose," issue-association, or other Pro-tier feature shown in the reviewed screenshot.
