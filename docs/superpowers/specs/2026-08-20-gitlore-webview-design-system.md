# GitLore webview design system — design spec

**Status:** approved direction, spec for review before planning
**Author:** Claude (design session with Raj), 2026-08-20
**Supersedes:** the VS Code-theme-derived styling currently in every `media/*.css` file

## 1. Why

GitLore's webviews currently derive every color from VS Code's own `--vscode-*` theme variables. That's correct for editor decorations (blame text, ownership ruler) — they have to blend into whatever theme and syntax highlighting the user already has open. But for the *panels* — Commit Graph, Launchpad, Branch Comparison, Commit/PR Details, Rebase Editor, Visual File History, Chat — it produces a generic, templated look: GitLore's own product identity is invisible, every install looks different depending on the user's theme, and nothing distinguishes it from "a webview someone built."

Decision (this session, with visual mockups compared side by side): drop VS Code theme-derivation for these eight webview panels and give GitLore its own distinct visual identity — dark-mode-first, restrained, developer-tool-flavored, not templated. Rejected Material Design 3 (reads as "a Google product," and leans on the rounded/tonal/gradient-heavy surface treatment GitLore's own anti-slop guardrails already warn against) and Fluent 2 (too close to VS Code's own native chrome — defeats the actual goal). Also rejected an unrestrained gradient treatment (decoration for its own sake) and a violet/indigo accent (the current default "premium dev tool" color — Linear, Raycast, GitHub Copilot, most AI-tool branding already lives there; adopting it doesn't make GitLore distinctive, it makes it blend into a different cliché).

## 2. Scope — what this does and does not touch

**In scope (webview-rendered, can carry a full CSS design system):**

| View | Provider |
|---|---|
| Commit Graph | `CommitGraphViewProvider` |
| Commit Details | `CommitDetailsViewProvider` |
| Branch Comparison | `BranchComparisonViewProvider` |
| Pull Request Details | `PullRequestDetailsViewProvider` |
| Interactive Rebase Editor | `RebaseEditorProvider` (custom text editor, webview-backed) |
| Visual File History | `VisualFileHistoryViewProvider` |
| Launchpad | `LaunchpadViewProvider` |
| GitLore Chat | `ChatViewProvider` |

**Out of scope — not a policy choice, a technical one.** These are native VS Code UI surfaces with no CSS of their own; they cannot be reskinned regardless of this decision, and must keep deriving from `ThemeColor`/`editor.fontFamily` exactly as CLAUDE.md §18 already requires:

- Inline blame decoration, full-file blame gutter, ownership ruler — `vscode.TextEditorDecorationType`, rendered by the editor itself.
- Blame hover card — `vscode.Hover` with a `MarkdownString`, rendered by VS Code's native hover popup, not a webview.
- Sidebar Explorer, File History tree — `vscode.TreeItem` rows, rendered by VS Code's native tree widget.
- Status bar item, CodeLenses — native VS Code chrome.

If this is ever revisited, reskinning any of the above isn't an option VS Code's API offers — worth stating plainly so it isn't relitigated later as an oversight.

## 3. Design tokens

### 3.1 Color — dark (default)

| Token | Value | Use |
|---|---|---|
| `--gl-bg` | `#0F172A` | Webview background |
| `--gl-surface` | `#1B2336` | Cards, panels |
| `--gl-surface-2` | `#1E293B` | Nested surfaces (toolbar, repo row, secondary cards) |
| `--gl-border` | `#2C3B57` | All borders/dividers |
| `--gl-text` | `#F8FAFC` | Primary text |
| `--gl-text-muted` | `#94A3B8` | Secondary text, metadata |
| `--gl-accent-start` | `#2DD4BF` | Gradient stop 1 (teal) |
| `--gl-accent-end` | `#0891B2` | Gradient stop 2 (cyan) |
| `--gl-accent-solid` | `#2DD4BF` | Flat fallback (icon hover color, borders where a gradient would be visual noise) |
| `--gl-accent-dim` | `#123B3B` | Accent-tinted background (e.g. behind a primary-action icon) |
| `--gl-on-accent` | `#062024` | Text/icon color on a filled accent surface (the accent is light enough that dark text reads better than white) |
| `--gl-hover-bg` | `rgba(255,255,255,0.04)` | Hover state for rows/buttons on any surface — one shared value rather than a per-surface hover color |

**Semantic colors — reserved, never used for brand identity:**

| Token | Value | Meaning |
|---|---|---|
| `--gl-success` | `#22C55E` | Additions, "ready"/"merged" states, positive diff |
| `--gl-danger` | `#EF4444` | Deletions, "blocked"/destructive states |
| `--gl-warning` | `#EAB308` | "Waiting"/pending states |

This split is the whole point of the color system: **the brand accent (teal/cyan) never means "add" or "danger,"** and git's own semantic colors never get reused as decoration. A diffstat bar and a "this is GitLore chrome" indicator must never be visually confusable.

**Gradient usage rule:** `--gl-accent-start`/`--gl-accent-end` as a gradient are reserved for exactly three kinds of element, never a whole surface/card/background:
1. A brand mark (e.g. the small dot before "LAUNCHPAD" in the toolbar).
2. The single primary-action affordance per card/row (never more than one per component instance).
3. One column/section's accent indicator, when that section represents "the thing most likely to need your attention right now" (e.g. Launchpad's Needs Review column) — every other column/section uses the semantic colors above or no accent at all.

Everywhere else — card backgrounds, toolbars, borders, hover states — flat solid color only. No gradients on surfaces, no glassmorphism, no drop shadows beyond the minimal ones already in use for depth-of-1 elements (a card sitting on a surface).

### 3.2 Color — light (designed counterpart, not a database match)

No verified "developer tool, light mode" reference existed in research — this is a deliberate extrapolation from the dark palette, following Minimalism & Swiss Style's monochrome-first approach (verified to support both modes):

| Token | Value |
|---|---|
| `--gl-bg` | `#F8FAFC` |
| `--gl-surface` | `#FFFFFF` |
| `--gl-surface-2` | `#F1F5F9` |
| `--gl-border` | `#E2E8F0` |
| `--gl-text` | `#0F172A` |
| `--gl-text-muted` | `#64748B` |
| `--gl-accent-start` | `#0D9488` |
| `--gl-accent-end` | `#0E7490` |
| `--gl-accent-solid` | `#0D9488` |
| `--gl-accent-dim` | `#CCFBF1` |
| `--gl-on-accent` | `#062024` |
| `--gl-hover-bg` | `rgba(0,0,0,0.03)` |

Same teal/cyan family, deepened for 4.5:1 contrast on a white surface (the dark palette's `#2DD4BF` fails contrast on white). Semantic success/danger/warning keep their hex values — they're already contrast-safe on both backgrounds at the specified use sizes; verify at implementation time.

**Which mode applies:** each webview reads `window.matchMedia('(prefers-color-scheme: dark)')` at render time and picks the token set accordingly — this tracks the OS/VS Code's light-vs-dark signal (still available in a webview), independent of which specific VS Code color theme is active. This is GitLore's own light/dark toggle now, not VS Code's — a user on a light *custom* theme still gets GitLore's own designed light palette, not a color pulled from their theme.

### 3.3 Categorical palette (lane coloring, ownership heatmap)

A third color concept, distinct from both the brand accent and the reserved semantic colors: `colors.ts`'s `CHART_THEME_COLOR_IDS` currently cycles through VS Code chart tokens to give the Commit Graph's per-branch lanes and the ownership heatmap's per-author coloring N *visually distinct but meaningless* colors — no lane "means" orange, it's just different from its neighbors. This needs its own fixed palette, chosen to be distinguishable from the brand accent and from success/danger/warning:

| Token | Value |
|---|---|
| `--gl-cat-1` | `#3B82F6` (blue) |
| `--gl-cat-2` | `#F97316` (orange) |
| `--gl-cat-3` | `#A78BFA` (violet) |
| `--gl-cat-4` | `#F472B6` (pink) |
| `--gl-cat-5` | `#6366F1` (indigo) |
| `--gl-cat-6` | `--gl-text-muted` (fallback/overflow, matching the existing `charts.foreground` fallback behavior) |

`colors.ts`'s `chartCssVarForIndex`/`chartThemeColorIdForIndex` and the recency-gradient functions get repointed at this list instead of `CHART_THEME_COLOR_IDS`/`RECENCY_GRADIENT_COLOR_IDS` — same cycling logic, fixed values instead of theme lookups.

### 3.4 Typography

| Token | Value | Use |
|---|---|---|
| `--gl-font-ui` | `'IBM Plex Sans', sans-serif` | Labels, titles, body text, buttons |
| `--gl-font-mono` | `'JetBrains Mono', monospace` | SHAs, branch/tag/repo identifiers, diffs, anything code-shaped |
| `--gl-text-xs` | `11px` | Metadata, badges |
| `--gl-text-sm` | `12.5px` | Card titles, secondary labels |
| `--gl-text-base` | `13px` | Body default |
| `--gl-text-md` | `14px` | Section headers |
| `--gl-text-lg` | `16px` | Panel titles |
| Weight scale | `400` / `500` / `600` | regular / medium (emphasis) / semibold (headers, primary actions) |

Both fonts are self-hosted under `media/fonts/` and bundled with the extension — GitLore's CSP (`default-src 'none'`) already blocks remote font loading, and that stays true; no CDN `@import`.

### 3.5 Spacing, radius, elevation

| Token | Value |
|---|---|
| `--gl-space-1` … `--gl-space-6` | `4px, 6px, 8px, 12px, 16px, 24px` |
| `--gl-radius-sm` | `4px` (buttons, badges, chips) |
| `--gl-radius-md` | `6px` (cards, columns, toolbars) |
| `--gl-radius-lg` | `8px` (panel-level containers, rare) |
| Elevation | One level only: `0 1px 2px rgba(0,0,0,0.24)` dark / `0 1px 2px rgba(0,0,0,0.06)` light, on cards sitting atop a surface. No second elevation tier — depth is communicated by border + surface-color contrast, not shadow stacking. |

Sharp, low-radius throughout — deliberately smaller than MD3's rounding, matching the "confident, not soft" read from the approved mockup.

### 3.6 Iconography

No verified icon-style database match (searched twice — recorded here as a documented gap, not silently defaulted). Falls back to existing practice, which already matches general best guidance: SVG line icons via `src/views/icons.ts`'s existing `icon()` helper (16×16 viewBox, `currentColor` stroke, no icon font, no emoji). **No change needed here** — this part of GitLore's webview code already does the right thing; the design system adopts it as-is rather than replacing it.

### 3.7 Motion

No change to the motion system built in the recent UI-polish pass (`--gitlore-motion: 140ms ease-out`, the `.gitlore-enter` keyframe, `prefers-reduced-motion` handling) — it's already correct and independent of the color/typography/surface decisions here. This spec is additive to it, not a replacement.

## 4. Accessibility

Dropping `--vscode-*` variables means GitLore is now responsible for contrast that VS Code's theme system used to guarantee automatically:

- Every text/background pairing above must be checked against WCAG AA (4.5:1 body text, 3:1 large text/UI components) for **both** palettes at implementation time — this spec states target hex values, not yet a verified contrast audit.
- Keyboard navigation, focus rings, and ARIA labeling requirements (CLAUDE.md §18) are unchanged and unaffected by this color/typography swap.
- `prefers-reduced-motion` handling is unaffected (§3.6).
- Semantic colors (success/danger/warning) must remain distinguishable from each other and from the accent by more than hue alone for color-blind users — pair with icon/text as already required by CLAUDE.md §18's "never rely on color alone."

## 5. Required CLAUDE.md changes

This is a deliberate policy change, not a quiet override — CLAUDE.md must be updated alongside implementation so it stops contradicting the code:

- **§18 Accessibility & UX**: "Blame decorations must meet contrast... derive colors from `ThemeColor`, never hardcode hex" — needs a scoping clause: this rule continues to govern editor decorations, hover cards, tree items, and status bar (native VS Code UI, §2's out-of-scope list), but no longer governs the eight webview panels listed in §2, which now use GitLore's own fixed design-token palette (§3) instead of `ThemeColor`.
- **§18**: "Honor the user's `editor.fontFamily` inside webviews where it reads as editor content" — needs the same scoping clause: this still applies to any literal code/diff content rendered inside a webview (a diff hunk, a commit's full patch), which should still read as "your editor's font," but UI chrome (labels, titles, buttons) now uses `--gl-font-ui`/`--gl-font-mono` regardless of the user's editor font setting.
- **§6 Dependencies**: no new runtime dependency is introduced (fonts are static files, not an npm package), but `media/fonts/` as a new bundled-asset directory should be noted.
- **§20 What NOT to do**: "No decoration animations/transitions" is unaffected (already scoped to *decorations*, not webviews) — no change needed there, called out here only to confirm no conflict.

## 6. Open questions for implementation planning (not resolved by this spec)

- Font file licensing/size: both IBM Plex Sans and JetBrains Mono are open-source (SIL Open Font License) and safe to bundle, but exact subset/weight selection affects the extension's package size (§12 performance budget) — should be resolved by picking the minimum weight set actually used (400/500/600, per §3.3) rather than shipping full font families.
- Rollout order: all eight webviews at once, or the more visual-heavy ones first (Commit Graph, Launchpad) to de-risk before touching the AI-heavy ones (Chat, Commit/PR Details)? Recommend the latter — smaller blast radius, faster feedback loop — but this is a sequencing call for the implementation plan, not this spec.
- Existing tests assert on current class names/markup in every affected `render.ts` — a token-system swap should be color/font/spacing only, not a markup restructure, to avoid an unrelated test-rewrite sweep alongside the visual change.

## 7. What this spec does not decide

No implementation plan, no task breakdown, no file-by-file change list — that's the next step (`writing-plans`) once this spec is reviewed.
