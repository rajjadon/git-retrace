# Changelog

All notable changes to GitLore are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The VS Code Marketplace shows this file on GitLore's extension page, so entries describe what changed for someone *using* GitLore. Why a change was made the way it was belongs in the commit message and in code comments, next to the code it explains.

## [Unreleased]

## [0.3.1] - 2026-08-13

### Changed

- Removed named comparisons to other extensions from the README, code comments, and docs. No functional change — GitLore's behavior, settings, and commands are unaffected.

## [0.3.0] - 2026-08-13

AI features, the stale-code detector, and the author ownership heatmap — closing out Phase 2 of the roadmap. All opt-in features stay off until you turn them on; nothing here changes what data leaves your machine.

### Added

**AI commit summaries** — opt-in, using your own model

- A **Summarize with AI** button in Commit Details streams a plain-English summary of the open commit.
- Off by default. Turn it on with `gitLore.ai.enabled` — nothing is sent anywhere until you do.
- Uses whatever language model you've already registered with VS Code (e.g. GitHub Copilot Chat) via the built-in Language Model API. No GitLore backend, no API key, no account.
- Needs a language model registered to produce anything — without one, the panel shows an inline hint instead of erroring.

**AI line explanations** — "why does this line exist?", from the blame hover

- The blame hover's **Explain this line with AI** link generates the explanation in the background — a small status-bar spinner shows while it runs, no panel opens. Re-hover the same line once it's done and the hover card shows the finished explanation directly.
- Reuses the exact same `gitLore.ai.enabled` gate and AI infrastructure as commit summaries: off by default, no model registered shows the same inline hint, and nothing is sent anywhere unless you've opted in.

**Stale-code detector**

- Functions and methods untouched for longer than `gitLore.staleThresholdDays` (default 180) get a subtle CodeLens — click it to open Commit Details for the commit that last changed them.
- On by default. Turn it off with `gitLore.staleCode.enabled`.
- Works for any language with a symbol provider installed (uses VS Code's built-in `executeDocumentSymbolProvider` — no new parser).
- Known limitation: an arrow function assigned to a top-level `const` (e.g. `export const foo = () => {}`) isn't flagged in v1 — TypeScript's language server reports these as `SymbolKind.Variable`, not `Function`, and flagging every Variable would also catch plain data constants as "stale." Named `function` declarations and class methods are unaffected.

**Commit Graph: row tooltip and icon headers**

- Hovering or keyboard-focusing a commit row shows a tooltip with the author, full commit message, age/date/SHA, and diffstat — no more waiting on native browser tooltips split across separate cells.
- The Author, Changes, Commit Date, and SHA column headers are now compact icons (each still announces its real name to screen readers via `title`/`aria-label`).

**Author ownership heatmap** — closes out Phase 2 of the roadmap

- Turn on `gitLore.ownership.enabled` for a colored mark in the overview ruler for every line, colored by that line's author (from a 7-color palette shared with the commit graph — with more than 7 authors, colors repeat), so you can see at a glance who owns which regions of a file.
- **GitLore: Show File Ownership** lists every author on the current file, weighted by recency (a line touched last week counts for more than one untouched for years) rather than raw line count, most-recently-active author first — with their share, line count, and last-active age.
- Off by default (the ruler marks); the command works regardless. Respects `gitLore.maxBlameFileSize` and `gitLore.blame.ignoreWhitespace` like the rest of blame.

### Changed

- Commit Details and Branch Comparison now start collapsed beside the commit graph instead of sitting open and empty. Clicking a commit row expands Commit Details; the compare-branches button expands Branch Comparison. (Only affects workspaces opening the GitLore panel for the first time — VS Code remembers your own manual layout choices after that.)

## [0.2.0] - 2026-08-11

First stable release — installs by default, with no need to opt into pre-releases. Same code as the `0.1.0` pre-release, promoted after verification.

Blame, history, the commit graph, commit details and branch comparison are all here and covered by tests. It is still `0.x`: expect breaking changes before `1.0`. AI features are not in this release — see Known limitations.

### Added

**Inline blame**

- The current line's author and age, shown as a muted, right-aligned editor decoration. Updates when you move to a different line, not on every keystroke. Toggle with **GitLore: Toggle Inline Blame**.
- Hover any line for a card with the author's avatar, the full commit message, relative and absolute dates, that commit's diff stat for the file, and the short SHA.
- The same author and age in the status bar. Click it to open the commit.
- Blame is skipped on files larger than `gitLore.maxBlameFileSize`, and stays silent on untracked files, unsaved files, and folders that aren't git repos.

**File history**

- **GitLore: Show File History** lists every commit that touched the current file, newest first, in the Explorer — following the active editor as you switch files. Click an entry to open its details; right-click to copy its SHA. Renames are followed.

**Commit graph** — in a "GitLore" tab in the bottom panel

- A repo-wide, branch-and-merge-aware graph of every commit, with curved merge lines, per-lane colors that follow your theme, and each author's avatar at their commit.
- Seven columns: Branch/Tag, Graph, Commit Message, Author, Changes, Commit Date, SHA. The header stays put while you scroll, and narrow panels scroll sideways instead of clipping.
- Local branches, the checked-out branch, remote-tracking branches and tags each get their own label style and icon.
- A toolbar to scope the graph to one branch, filter commits by message/author/SHA as you type, see a live commit count, and refresh.
- Uncommitted work is pinned above the newest commit as a **Working Changes** row with `+added ~modified −deleted` file counts. Click it to jump to Source Control.
- Arrow keys move the selection, Enter opens the commit, and your place survives a refresh.

**Commit details** — same panel

- The commit's subject, author, date and SHA in a compact header, plus **Copy SHA**, **Copy message**, and **Open on GitHub/GitLab/Bitbucket** when your remote is one of those.
- Every changed file as a collapsible section holding only that file's hunks, with a filter box, per-file counts and whole-commit totals. A single-file commit opens expanded.
- Diffs show old and new line numbers in a gutter, tint changed lines, and offer a **Wrap long lines** toggle. Line numbers stay out of your selection, so copying a diff gives you just the code.
- **Open changes** on any file row opens it in a real diff editor, with syntax highlighting and folding.

**Branch comparison** — same panel

- Two ref pickers with a swap button, colored by diff polarity: the base in the removed hue, the compare ref in the added hue, matching the `-`/`+` lines below.
- **Ahead**, **Behind** and **All Files** tabs with counts, opening on whichever has something to show. Diffs are taken against the merge-base, like a GitHub or GitLab pull-request diff.
- Click any commit to open its details.

**Issue and PR linking**

- References like `#123` in commit messages become links, in both the blame hover and commit details. Auto-detected from your GitHub or GitLab remote, or point it at any tracker with `gitLore.issueLinking.pattern` and `.urlTemplate`.

**Throughout**

- Every command is a button in a GitLore panel view's title bar, so nothing requires the command palette.
- All four views are keyboard-navigable, take their colors from your theme in both light and dark, and honour `prefers-reduced-motion`.
- Fully local and free. No account, no telemetry, no paid tier. The only network request is fetching author avatars from Gravatar; see the README's Privacy section.

### Known limitations

- No AI features yet. Commit summaries and line explanations are planned, using your own model via VS Code's Language Model API — no GitLore account or API key.
- No staging, stashing or committing. That's VS Code's Source Control view — the Working Changes row links you there.
- The graph doesn't refresh itself when the repo changes; use the toolbar's refresh button.
- The changed-file list is flat, with no tree view of paths.
- Commit details loads a whole commit's diff up front, so a very large commit takes a moment to open.
- Toggling inline blame from the panel button gives no on/off indicator; the editor shows the result immediately.
- File History appears in the Explorer, not in the GitLore panel.

## [0.1.0] - 2026-08-11

Pre-release alpha, published to the Marketplace's pre-release channel. Identical feature set to `0.2.0`; superseded by it. `0.1.x` remains the pre-release line.
