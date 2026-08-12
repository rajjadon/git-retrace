# GitLore blame hover — design critique

Scope: native `vscode.Hover` content only (`src/utils/format.ts` → `formatBlameHover`/`formatLineExplanation`, wired in `src/providers/BlameHoverProvider.ts`). No webview, no custom CSS — markdown-in-hover only. Ground truth confirmed by reading source and `node_modules/@types/vscode/index.d.ts`, and by checking a real bundled `codicon.css` (`/Applications/Visual Studio Code.app/.../simple-browser/media/codicon.css`) for which icon names actually exist.

---

## 1. Visual distinctiveness against a look-alike neighbor provider

**What's wrong.** GitLore's block and VS Code's built-in git hover block (the second half of screenshot 1) use the *same shape*: avatar thumbnail → bold name → commit message → relative+absolute date → monospace SHA. Screenshot 1 makes the collision concrete — both blocks literally say "first commit," both show "~5 months ago (25 March 2026 at 18:11)," both show a SHA badge. The only thing that isn't duplicated is GitLore's plain-blue "Explain this line with AI" link, and it's styled identically to any other link in the pane, so it doesn't register as "the one thing only GitLore has." A user sees one tall box of repeated, slightly-contradictory git facts, not two attributed sources.

The contradiction compounds it: GitLore's line shows `+293 -0` (this file, this commit) directly above VS Code's own `23 files changed, 5453 insertions(+)` (whole commit). Same visual weight, wildly different numbers, no label explaining the different scope — reads as "the number is wrong," not "these are two different measurements."

**Why it matters.** Per the design brief's own principle — *"structure is information"* — right now GitLore's structure encodes zero information about provenance. Nothing here is a GitLore bug (multi-provider hover merging is expected VS Code behavior GitLore can't suppress), but GitLore's markdown is the only side of this it *can* shape, and today it does nothing to defend its own identity when stacked next to a look-alike.

**Recommendation.** Two concrete, cheap moves — no masthead/branding line added to the top (that costs a line on every single hover for marginal gain and fights §4.3's "minimal surface area, a UI element must earn its place"):

1. **Cap GitLore's content with a trailing rule.** Append a markdown thematic break after the AI section, unconditionally:
   ```
   ...AI section content...

   ---
   ```
   This guarantees a clean seam between "GitLore's content" and whatever renders after it (another provider's hover, or nothing), regardless of whether VS Code's own inter-provider divider shows up — which screenshot 2 shows it doesn't always do cleanly (see §3). Caveat: extensions don't get a documented ordering guarantee for merged hovers, so this only brackets the case where GitLore renders first — the case actually observed in all three screenshots. Don't also add a leading rule to guard the unobserved reverse case; that's speculative cost for a scenario with no evidence it happens.

2. **Disambiguate the diffstat's scope so it can't be read as contradicting the neighbor.** Change the bare `+293 -0` line to name its scope explicitly:
   ```
   $(diff) +293 -0 in this file
   ```
   (`diff` is a real codicon — confirmed in the bundled `codicon.css`.) This does double duty: it's evidence-based disambiguation for point 1, *and* it makes the block self-describing without adding a branding line.

Do **not** try to out-style VS Code's block (can't — no CSS control). The fix is: make GitLore's one truly unique element (the AI line) carry more visual weight (→ point 2), and terminate cleanly so nothing bleeds across the seam (→ point 3's parallel finding from screenshot 2).

---

## 2. Icon vs. text for the AI action

**Verified API.** `MarkdownString.supportThemeIcons` is real (`index.d.ts` line 3035, constructor overload at line 3076): `$(icon-name)` is only iconified when this is `true`. **Confirmed real codicon names** (grepped directly out of a bundled `codicon.css`, not guessed): `sparkle`, `sparkle-filled`, `wand`, `lightbulb`, `comment-discussion`, `hubot`, `robot`, `zap`, `question`, `loading`, `diff`.

**What's wrong / gap found.** `BlameHoverProvider.ts` line 48 constructs `new vscode.MarkdownString(...)` and only sets `markdown.isTrusted = {...}` on line 51 — it never sets `supportThemeIcons`. If a codicon is added to `format.ts` today, it will render as the literal text `$(sparkle)`, not an icon. This has to be fixed alongside any icon recommendation, not as an afterthought:
```ts
markdown.isTrusted = { enabledCommands: [COMMANDS.explainLine] };
markdown.supportThemeIcons = true;
```

**Recommendation — which icon.** GitLore already has an established AI visual vocabulary: `src/views/icons.ts` defines `AI_ICON`, a custom four-point sparkle SVG, used in the CommitDetails webview as `${AI_ICON}Summarize with AI` (button) and `${AI_ICON}AI Summary` (section heading) — i.e., icon+short-label, never icon-only, always a sparkle motif. The codicon `sparkle` is the exact semantic match (four-point sparkle glyph) — use it in the hover for consistency of metaphor even though the literal rendering technique differs (inline SVG in the webview vs. codicon glyph in the hover). Don't reach for `wand`/`lightbulb`/`hubot` — they'd introduce a second, unrelated "AI" glyph the user has to separately learn.

**Recommendation — icon-only vs. icon+label.** Keep icon **+ short label**, not a bare icon. Reasoning specific to this surface: a `[...](command:...)` markdown link is what gives it VS Code's link-blue color and click affordance — that's the *only* signal in a native hover that something is interactive (no button chrome, no hover-state background, codicons render as plain small themed-color glyphs with zero click affordance on their own). A bare `$(sparkle)` glyph without link markup would be indistinguishable from a decorative icon; wrapped bare in a link it would just be a tiny 16px hit target with no visible "this does something" cue. Space isn't actually the constraint here (the current text link is already its own full line) — discoverability is, so keep a label, just shorten it since the icon now carries the "AI" part:
```
[$(sparkle) Explain this line](command:gitLore.explainLine?<args>)
```
Dropped "with AI" — redundant once the sparkle is present, and shorter reads better in a cramped hover.

---

## 3. The three (really five) rendering states — do they read as one feature?

**What's wrong.** Today:
- *link*: `[Explain this line with AI](command:...)` — a plain blue link, no icon.
- *pending*: `⏳ Generating explanation…` — plain text prefixed with a Unicode emoji.
- *done*: `**Why this line exists:**\n\n${text}` — a bold heading + paragraph, no icon at all.
- *noModel* / *error* (exist in code, not asked about but relevant): plain sentence + the link again, no icon.

Three unrelated visual treatments for one evolving affordance: a link, a status line, a heading+paragraph — nothing visually threads them together, so switching states reads as "different content appeared" rather than "the same feature progressed." Concretely worse: `⏳` is a **Unicode emoji** — grepping the entire `src/` tree confirms it's the *only* emoji used anywhere in GitLore's UI. Once a codicon is introduced per point 2, mixing an emoji glyph (`⏳`) with a codicon glyph (`$(sparkle)`) for the same feature is two different icon systems for one affordance — worse, not better, than what exists now.

Also, screenshot 2 shows the concrete failure mode this causes: the "done" paragraph text runs directly into a following, unrelated hover's raw code block (`const categoryQuestions: {}`) with **no divider at all** — unlike screenshot 1, where a rule *did* appear between providers. VS Code's inter-provider seam is not reliable enough for GitLore to depend on; GitLore has to draw its own boundary (this is the same fix as point 1's "trailing rule," restated here because the "done" state — the tallest, most text-heavy state — is where its absence hurts most).

**Recommendation.** Give all states one stable leading glyph (`$(sparkle)`) as the anchor, so position/icon stays constant and only what follows it changes — that's the "one feature evolving" signal, and it doubles as the brand mark from point 1:

- *link*: `[$(sparkle) Explain this line](command:gitLore.explainLine?<args>)`
- *pending*: `$(sparkle) $(loading~spin) Generating explanation…` — replace `⏳` with the codicon `loading` plus VS Code's standard `~spin` animation-modifier suffix (the same convention used for e.g. `$(sync~spin)` in status bar items across VS Code's own UI and its extension samples — a real, long-standing convention, not a typed API surface so it won't appear in `index.d.ts`, but it is the documented way to animate a `ThemeIcon` in markdown). This makes "pending" look like VS Code's own native busy-state, for free.
- *done*: `$(sparkle) **Why this line exists**\n\n${text}\n\n---` — sparkle stays as the anchor, heading unchanged, and the trailing rule (point 1) closes the block before anything else can bleed into it.
- *noModel* / *error*: keep the sparkle prefix on the re-offered link for the same reason (`$(sparkle) [Explain this line](command:...)`), don't invent a fourth treatment for what are really just failure variants of "link."

---

## 4. Overall information hierarchy

**Current order is basically right; don't reorder it.** Author → message → age/date/sha → diffstat → AI is the correct priority for a *blame* card (who → what → when/reference → magnitude → optional extra), and it matches how the source already groups things: the date/sha line and the diffstat line are pushed with **no blank line between them** (`format.ts` lines 93–98), which markdown renders as a tight, single visual row — deliberately gluing "commit facts" into one dense block — while the AI section gets a preceding blank line (`lines.push('', ...)`, line 100), giving it real paragraph separation. That's a sound existing decision: dense facts clustered tight, then a clear gap before the one dynamic/actionable part. Keep it. Also keep the AI section's position **fixed at the bottom regardless of state** — don't be tempted to promote a completed "done" explanation above the git facts just because it's the highest-value content once generated; a state-dependent position would break the "stable landmark" property point 3 relies on (users learn where to look/click, and that must not move based on state).

**Two things worth changing, both small:**

1. **Label the diffstat's scope**, as already specified in point 1: `$(diff) +293 -0 in this file`. This is a hierarchy fix as much as a distinctiveness fix — right now the diffstat sits at the *same* visual level as the SHA/date with no indication it's scoped to one file, which is exactly what let it collide with VS Code's whole-commit stat in screenshot 1.
2. **Watch the "done" state's length budget.** `formatLineExplanation`'s `done` branch (`format.ts` line 53) interpolates `state.text` with no truncation or character cap — `core/ai/prompts.ts`-style budgets exist for the commit-summary path (`gitLore.ai.maxDiffChars`) but nothing caps the *rendered* explanation length here. A long model response pushes the whole hover very tall, burying the compact, high-signal author/message/date block under a wall of prose and making the point-1 "which section is whose" problem worse simply through sheer vertical distance. Not asked for directly, but it's a hierarchy risk: hierarchy isn't just ordering, it's also what dominates the vertical space. Recommend capping displayed explanation length (e.g., a few hundred characters with a "Show more"-less hard truncation + ellipsis, since a hover can't do progressive disclosure) rather than leaving it unbounded.

No case for regrouping SHA/age/date internally (e.g., leading with SHA) — that's cosmetic churn on a part of the card that isn't actually causing the confusion; leave it.
