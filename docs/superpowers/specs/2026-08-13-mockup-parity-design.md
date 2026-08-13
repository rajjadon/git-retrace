# GitLore Mockup Parity — Design

Covers Phases 4–7 of the roadmap (`CLAUDE.md` §7): everything shown in the reference mockups that GitLore doesn't build yet. Phases 1–3 (blame, hover, file history, commit details, status bar, AI features, stale-code, ownership, commit graph, branch comparison, issue linking) already ship and are out of scope here.

No feature in this document references any competitor product or company by name, in code, comments, settings, commands, or docs. GitLore ships under its own name only.

## Platform ceiling (read first)

Three of the seven pieces below render through native VS Code UI primitives that cannot be pixel-matched to a custom mockup — this is an API limit, not an effort trade-off:

- **Hover** (`vscode.Hover`) — sanitized markdown only. No custom CSS, no flex layouts, no pill badges, no button rows.
- **TreeView** — one label, one dimmed description, one icon per row. No inline colored badges, no multi-color text, no avatar-with-initials.
- **Editor decorations** — gutter icons are images or theme colors; there is no "arbitrary boxed panel" decoration type.

Webviews and Custom Text Editors have no such ceiling — full HTML/CSS, pixel-identical to a mockup is achievable. The plan below builds the webview-based pieces to full visual parity and the native-UI pieces to best-effort parity (icons, structure, color where the API allows it).

## Build order

1. Visual File History (webview, read-only, no risk)
2. Interactive Rebase Editor (webview/custom editor, **rewrites history** — highest risk, most scaffolding)
3. Sidebar Explorer tree (native TreeView, best-effort)
4. Branch Compare polish (extends existing webview, small)
5. Hover quick-actions + revision nav (native hover, best-effort — already designed in chat, included here for completeness)
6. Full-file gutter blame + heatmap toggle (native decorations, best-effort)
7. Launchpad (webview + GitHub API, last, optional — sketch only, full design deferred)

Each ships as its own commit-sized unit of work with its own tests before the next one starts — this is one spec, not one diff.

---

## 1. Visual File History

**What:** author-swimlane bubble timeline for one file — x = time, y = author lane, bubble radius = lines changed, plus additions/deletions bars. Read-only.

**Data:** one new `GitService.getFileHistoryStats(filePath, maxCount)` — `git log --follow --numstat --pretty=tformat:LOG_FORMAT -- <path>`, one call. `--numstat` scoped to a single path emits at most one stat line per commit, so this reuses the same "line carries the field separator → new record; otherwise → stat line for the current record" walk already implemented in `parseGraphLog`. New pure parser `parseFileHistoryLog(raw): FileHistoryEntry[]` in `parsers.ts`, new type `FileHistoryEntry extends Commit { insertions: number; deletions: number }` in `types.ts`.

**Layout:** pure function `layoutFileHistory(entries, now): FileHistoryPoint[]` in `core/graph/fileHistoryLayout.ts` (sibling to the existing `core/graph/layout.ts` DAG layout) — assigns each author a lane (first-seen order), each entry an x-position (time-scaled across the entry range), and a radius (scaled off `insertions + deletions`). Zero `vscode` imports, unit-testable like `layout.ts`.

**View:** `src/views/VisualFileHistory/VisualFileHistoryViewProvider.ts` + `render.ts`, new `visualFileHistory.css`, following the exact `CommitGraphViewProvider` shape (`WebviewViewProvider`, `resolveWebviewView`, `load`, `handleMessage`). Rendered as inline SVG — circles for commits, bars for +/-, dashed lane guides, axis labels — no canvas, no new dependency. New view `gitLore.visualFileHistory` registered in the existing `gitLore` panel container (`visibility: collapsed`, same as Commit Details/Branch Comparison). Row hover reuses the tooltip pattern already built for Commit Graph rows in 0.3.0. Clicking a bubble sends `openCommit` → existing `gitLore.showCommit` command, same as the Commit Graph.

**Command:** `gitLore.showVisualFileHistory` (new `COMMANDS` entry), wired the same way `gitLore.openGraph` wires `CommitGraphViewProvider.show()`.

**Settings:** none new — reuses `gitLore.maxHistoryItems`.

**Tests:** golden-file test for `parseFileHistoryLog`; unit tests for `layoutFileHistory` (lane assignment, radius scaling, empty/single-author/single-commit edge cases); integration test for view registration + placeholder render.

---

## 2. Interactive Rebase Editor

**What it is, precisely:** a GUI for the file git already opens when you run `git rebase -i` — `.git/rebase-merge/git-rebase-todo`. Git spawns whatever `sequence.editor` is configured, blocks, and waits for that editor process (or, for `code --wait`, that specific tab) to close before continuing the rebase with whatever the file now contains.

**How GitLore hooks in — no reinvented rebase logic:**
- Register a **Custom Text Editor** (`vscode.window.registerCustomEditorProvider`, `viewType: gitLore.rebaseEditor`) for the pattern `**/{rebase-merge,rebase-apply}/git-rebase-todo`, contributed via `customEditors` in `package.json` with `"priority": "default"`. A setting `gitLore.rebaseEditor.enabled` (default `true`) lets it fall back to the plain text editor.
- New command **`gitLore: Rebase Branch Interactively...`** — prompts for a target ref (reusing the branch picker already built for Branch Comparison), then runs `git -c sequence.editor="code --wait" rebase -i <ref>` in a VS Code integrated terminal. The `-c` flag is a one-off override, scoped to that single invocation — GitLore never writes to the user's `~/.gitconfig`. Users who've already configured `code --wait` as their global sequence editor get the same custom-editor UI for free, with no GitLore command involved at all.
- The custom editor's `resolveCustomTextEditor` reads `document.getText()`, parses it, and renders the drag-reorder UI. **"Start Rebase"** applies a `WorkspaceEdit` writing the reordered/re-labeled todo back, saves the document, then closes the tab (`workbench.action.closeActiveEditor`) — that closure is what unblocks git's waiting child process. GitLore does not call `git rebase` itself at any point in this path; it only ever edits and closes a file.
- **"Abort"** clears the todo to an empty document before closing — git's own documented behavior for an empty sequence is to stop cleanly with no commits rewritten. GitLore never runs `git rebase --abort` or any reset/checkout command from this UI.

**Parsing:** new pure module `core/git/rebaseTodo.ts` — `parseRebaseTodo(raw): RebaseEntry[]` (command, sha, message per non-comment/non-blank line) and `serializeRebaseTodo(entries): string`. Comment lines (git's own help text) are read and discarded, not preserved — git only requires the command lines.

**Conflicts (scope cut):** if `.git/rebase-merge/` still exists shortly after the editor closes, the rebase paused on a conflict. GitLore shows one information message pointing at Source Control (`workbench.view.scm`) rather than building a conflict-resolution panel — VS Code's own merge UI already owns that job, and duplicating it contradicts "minimal surface area." The mockup's inline conflict list is **not** built in v1.

**Safety boundary (explicit, non-negotiable for this feature):**
- The only git-mutating actions this feature ever takes are (a) the one `git rebase -i` the user explicitly asked to start, via the one command above, and (b) writing the todo file itself, which is exactly what the real editor is *for*.
- No auto-triggered `--abort`, `--continue`, `reset --hard`, or `checkout` from any button.
- Dirty-working-tree and in-progress-rebase checks are git's own (it already refuses to start under those conditions) — GitLore surfaces git's stderr rather than pre-flighting the same checks itself.

**Tests:** golden-file tests for `parseRebaseTodo`/`serializeRebaseTodo` round-tripping real `git-rebase-todo` fixtures (including comment stripping); integration test that the custom editor registers for the right glob and round-trips a document edit.

**Open question for you before implementation starts:** confirm the `code -c sequence.editor="code --wait" rebase -i` command approach (vs. requiring users to configure `sequence.editor` globally themselves) — it's the more self-contained option but it's also the first place GitLore spawns a terminal command on the user's behalf rather than only reading/writing files.

---

## 3. Sidebar Explorer tree

**What:** one new Activity Bar container (own icon, not nested in Explorer), one `TreeDataProvider` with six collapsible sections — Branches, Remotes, Tags, Stashes, Worktrees, Contributors — matching the single-tree structure in the mockup (not six separate views).

**New `GitService` methods** (each one call, one new pure parser in `parsers.ts`):
- `getBranches` — **extend**, don't replace: add `%(upstream:track)` to the existing `BRANCH_FORMAT`, which makes git compute ahead/behind counts itself (no per-branch `rev-list --count` calls). `BranchInfo` gains optional `ahead`/`behind` numbers.
- `getRemotes` — `git config --get-regexp "remote\..*\.url"` in one call, parsed into `{ name, url }[]`.
- `getTags` — `git for-each-ref refs/tags --format=...`, same shape as the existing branch parser.
- `getStashes` — `git stash list --format=...`.
- `getWorktrees` — `git worktree list --porcelain`.
- `getContributors` — repo-wide author aggregation. Reuses the accumulation shape already in `core/git/ownership.ts` (`computeOwnership` groups-by-email today, scoped to one file's blame lines) rather than a new algorithm — the repo-wide version sources from `git shortlog -sne HEAD` instead of blame lines, but the "group by email, sum a count, sort" shape is the same pattern.

**Best-effort rendering:** each section is a root `TreeItem` (label + count via `description`); each leaf renders what a `TreeItem` actually supports — label, dimmed `description` for the ahead/behind or URL, and a `ThemeIcon` (`BRANCH_ICON`-equivalent as a codicon id, since gutter/hover SVGs don't apply to tree items — VS Code tree items take a `ThemeIcon` or an image path, not inline SVG markup). No colored "current" pill (not supported); the current branch is instead marked via `description: '(current)'` and `contextValue` for a bold-ish `ThemeIcon` swap.

**v1 context menu actions** (ponytail cut — highest-value only, rest is follow-up): Branches → checkout, compare (reuses existing Branch Comparison); Remotes → open in browser; Stashes → apply, drop. Tags, Worktrees, Contributors are read-only in v1.

**New view:** `gitLore.explorer` in a new `viewsContainers.activitybar` entry. New commands for the context-menu actions above, added to `COMMANDS`.

**Tests:** unit tests per new parser (golden-file style); unit test for the tree provider's node-building logic (section → children shape); integration test for view registration and the checkout/compare/apply/drop commands.

---

## 4. Branch Compare polish

Three small, independent additions to the existing `BranchComparisonViewProvider`/`render.ts` — no new data model.

- **Diffstat bars** — `FileChange.insertions`/`deletions` already exist; add a CSS-only proportional bar (green width ∝ insertions, red width ∝ deletions) next to each file row in `renderFileSections`. Pure styling change.
- **"Create PR"** — new `buildCompareUrl(remote, base, compare)` in `utils/remoteLinks.ts` (sibling to the existing `buildCommitUrl`), producing `.../compare/base...compare` for GitHub and `.../-/merge_requests/new?...` for GitLab. Button → `vscode.env.openExternal`. Hidden when `resolveRemoteInfo` returns null, same guard `buildCommitUrl`'s caller already uses.
- **"Open all changes with common base"** — one `vscode.commands.executeCommand('vscode.changes', title, resourceUriPairs)` call, VS Code's own native multi-file diff editor. `resourceUriPairs` built from the existing `getFilesBetweenRefs` result plus `buildGitFileUri` (already in `GitContentProvider.ts`) for each side — no new webview UI, no new diff rendering.

**Tests:** unit test for `buildCompareUrl` (GitHub vs GitLab URL shapes, same style as existing `remoteLinks` tests); integration test that "Open all changes" invokes `vscode.changes` with the right pairs.

---

## 5. Hover quick-actions + revision nav

Full design already agreed in chat — included here only for completeness of the roadmap:

- `GitService.getLineHistory(filePath, line, maxCount)` via `git log --follow -L<n>,<n>:<path>`, new `parseLineHistoryLog` parser reusing the field-separator line-filter trick.
- Quick actions reuse existing commands (`showFileHistory`, `copySha`) plus one new `gitLore.compareLineRevision(filePath, sha)` wrapping the existing `openFileDiff`.
- ◀/▶ stepping: new `gitLore.stepLineBlame` command pins a historical sha in a small LRU, then re-triggers `editor.action.showHover` (a `Hover` can't update in place — this is the same "trigger command, re-open hover" pattern the AI line-explanation feature already uses).
- Cut: AI "Explain this line" stays live-blame-only; no caching on `getLineHistory` for v1.

---

## 6. Full-file gutter blame + heatmap toggle

**Ceiling check first:** a true left-of-line-numbers text column (what the mockup shows) isn't a supported VS Code decoration shape — gutter icons are images/`ThemeColor`s, not arbitrary text. The realistic best-effort version, and what this section builds:

- **Full-file blame overlay** — the existing current-line blame decoration (`BlameDecorationProvider`, end-of-line muted text), extended with a toggle command (`gitLore.toggleFileBlame`, new) that applies the same decoration style to *every* line at once instead of only the active line. Same data source (`BlameSource`), same formatting (`blameFormat` template) — the change is which lines get decorated, not a new rendering mechanism.
- **Heatmap edge** — reuses the exact mechanism `OwnershipDecorationProvider` already proved out: one `overviewRulerColor` decoration type per bucket, `CHART_THEME_COLOR_IDS`-sized palette. Where ownership buckets by author-hash, this buckets by commit age (hot→cold), via a new pure function `computeLineAgeColors(blameLines, now): LineAgeColor[]` in `ownership.ts`'s sibling style, feeding a new `HeatmapDecorationProvider` that's structurally a copy of `OwnershipDecorationProvider` with a different bucketing function.

**Settings:** `gitLore.fileBlame.enabled` (toggle state, not persisted differently from how `blame.enabled` works today), reuses `gitLore.heatmap`-style naming for the age palette — no new "hot/cold color" settings for v1 (ThemeColor-driven, matching how ownership colors work today).

**Tests:** unit tests for `computeLineAgeColors` (bucket boundaries, uncommitted-line exclusion, same shape as existing `computeLineColors` tests); integration test for the toggle command and decoration application.

---

## 7. Launchpad (sketch only — full design deferred)

Kept last per your call on mission-fit. Sketch, not a build-ready design:

- Opt-in via `gitLore.launchpad.enabled` (default `false`), same pattern as `gitLore.ai.enabled`.
- Auth: VS Code's built-in `vscode.authentication.getSession('github', ['repo'], { createIfNone: false })` — no GitLore backend, no proxied key, only requested when the user explicitly opens Launchpad.
- **v1 scope cut, needs your confirmation when we get here:** PRs for the *current workspace's* remote(s) only, not the arbitrary cross-repo board the mockup shows (GitGlass + two unrelated repos). Triaging repos you don't have open contradicts "makes sense of your repo" more than any other piece in this doc — worth re-deciding, not just building as shown.
- Webview, same `WebviewViewProvider` shape as the others — full visual parity is achievable here since it's a webview, unlike the native-UI pieces above.

Full design (data model, GitHub API calls, rate-limit/caching behavior, section logic) written when this phase actually starts.

---

## Self-review

- **Placeholders:** none — every section names concrete files, functions, and git commands.
- **Consistency:** every new GitService method follows the existing one-call, `raw()` + pure-parser, `GitCommandError`-on-failure shape. Every new webview follows the exact `WebviewViewProvider` shape already used by Commit Graph/Details/Branch Comparison. No section invents a new architectural pattern.
- **Scope:** seven independently shippable units, each with its own tests, matching "one feature, tests, next feature" rather than one combined diff.
- **Ambiguity resolved:** the rebase editor's "how does GitLore trigger the rebase" question is called out explicitly as open, rather than silently picked — needs your yes/no before implementation starts.
