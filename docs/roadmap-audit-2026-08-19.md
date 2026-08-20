# GitLore roadmap audit — 2026-08-19

Spike investigation, not an implementation plan. Grounded in the actual repo (126 files, 13.8k LOC, `code-review-graph` structural data, direct reads of `GitService.ts`, `LaunchpadViewProvider.ts`, `RepoExplorerProvider.ts`, `LruCache.ts`, `BlameSource.ts`, `CodeLensProvider.ts`, and every `media/*.css`). Phases 1–7 in `CLAUDE.md` §7 are genuinely all shipped — this document only covers what's *not* there yet, or where the existing implementation has a real, nameable gap.

**Headline finding before the tracks: there isn't much low-hanging fruit left.** The codebase already does the disciplined thing in most of the places CLAUDE.md prescribes it:
- Blame is cached (200-entry LRU) and debounced exactly 500ms (`BlameSource.ts`), invalidated via `createFileSystemWatcher` + `deleteWhere`, never polled — matches §10 verbatim.
- Commit graph's `--numstat` rides along on the single `git log` call instead of a per-row process spawn, with an explicit `ponytail:` comment naming the ceiling (`maxGraphItems`) and the upgrade path if it's ever raised.
- Independent git calls in `CommitGraphViewProvider` already use `Promise.all`.
- Every webview CSS file already has `prefers-reduced-motion` handling, a shared `--gitlore-motion: 140ms ease-out` token, and a reusable `.gitlore-enter` / `gitlore-shimmer` skeleton system — this is not a codebase that skipped animation polish.
- `parsers.ts` (575 lines) is 22 small, single-purpose pure functions — exactly the prescribed `parseX` pattern, not bloat. Not flagged.
- Cross-file mutation ops that can hit a conflict (merge, rebase, revert, cherry-pick, push/pull) are already correctly routed to a shared terminal instead of `simple-git`, per the documented Phase 7 rationale.

So the five tracks below are real gaps, not a padded checklist.

---

## Track 1 — New features / git operations not yet covered

| Finding | Why it matters | Suggested approach | Phase bucket | New setting? |
|---|---|---|---|---|
| **Sidebar Explorer is read/navigate-only for the exact entities it lists** — no delete branch, no rename branch, no delete tag, no worktree add/remove, no stash create (only `applyStash`/`dropStash` exist in `GitService`) | This is one systemic gap, not five: the tree already shows Branches/Tags/Stashes/Worktrees (Phase 5) but every write action beyond checkout/compare/merge/rebase is missing. Users hit this as "why can't I clean this up from here" | Add `GitService.deleteBranch/renameBranch/deleteTag/addWorktree/removeWorktree/createStash(message?)`, wire into `RepoExplorerProvider`'s existing right-click menus with a confirm dialog per §13's destructive-action pattern already used for Reset/Checkout | Extends Phase 5 | No |
| **No `.git-blame-ignore-revs` support** (`--ignore-revs-file` on `git blame`, supported natively since git 2.23) | The single most-requested blame feature in any editor integration — skips mass-reformat/lint-fix commits so blame lands on the real author. `GitService.blameFile` (`src/core/git/GitService.ts:111`) builds `['blame', '--line-porcelain']` with no such flag today | In `blameFile`, check for a `.git-blame-ignore-revs` file at `repoRoot` and pass `--ignore-revs-file <path>` when it exists — no setting needed, git's own filename convention is the standard | Extends Phase 1 (inline blame) | No |
| **No standalone Fetch** — Explorer/Launchpad's per-repo row (Phase 7) has Pull and Push only | Fetch-without-merge is the safe read op power users reach for before deciding whether to pull; the terminal pattern already exists, this is one more button | Add a Fetch button reusing the same `GitLore: Git Sync` terminal (`git fetch`) already used for Pull/Push | Extends Phase 7's per-repo row | No |
| **No reflog-backed recovery view** | The actual "oh no" moment (hard-reset gone wrong, deleted branch) has no dedicated UI — ironic since `resetTo` already offers hard/soft/mixed with a confirm dialog that creates exactly this risk, but nothing closes the loop | `GitService.getReflog(filePath)` wraps `git reflog`; a QuickPick or Explorer section listing reflog entries with date/message, action = "create branch at this SHA" | New Phase-5-adjacent command (`gitLore.recoverFromReflog`) | No |
| **Submodule handling is untested, not unimplemented** — §10 lists submodules as a required-handled case, but `grep -rin submodule src/` only turns up an icon name reused for worktrees | Not a feature gap so much as an unverified correctness claim — `simple-git` likely resolves a submodule's own `.git` file correctly via `getRepoRoot`, but there's no fixture proving it | Add a submodule fixture to `test/fixtures`, confirm blame/history resolve inside it. This is a test-coverage item, not new UI | N/A — correctness, not roadmap | No |
| **Bisect — explicitly not recommended** | Stateful multi-step CLI workflow, narrow power-user audience, doesn't fit "hover instead of panel" (§4.3); the terminal already does this fine | Skip. Revisit only if users actually ask | — | — |

---

## Track 2 — Code architecture

| Finding | Why it matters | Suggested approach |
|---|---|---|
| **`GitService` is the codebase's one real hotspot**: 771-line file, 713-line class, ~36 public async methods spanning blame, history, refs, stashes, worktrees, contributors, and mutations. It's also the most-imported module in the graph (`CommitGraphViewProvider`, `LaunchpadViewProvider`, `RepoExplorerProvider`, `BlameSource`, `FileHistoryProvider`, `explorerCommands`, and more all depend on it directly) | Every git-domain change touches this one file — it's the largest blast radius in the repo. But CLAUDE.md §10 requires it stay the *sole* `simple-git` import site, so the fix is internal decomposition, not a new entry point | Keep `GitService` as the public facade (no call site changes — `this.git.getBranches(...)` etc. stay identical); split its internals into `core/git/{RefsService,HistoryService,MutationService}.ts` that `GitService` composes in its constructor. Mechanical extraction, not a redesign — pays down the graph's single largest hub node for near-zero behavioral risk |
| **Everything else checked out clean, no action** | `parsers.ts` (575 lines / 22 pure `parseX` functions) is cohesive by design, not bloat. `render.ts` files (CommitGraph 565 lines, VisualFileHistory 470 lines) are template-string webview HTML, the expected shape for that layer, and diffstat-bar rendering is already centralized once in `diffRender.ts` (`renderStatBar`) rather than duplicated across views. No manufactured findings here | — |

---

## Track 3 — Performance

| Finding | Why it matters | Suggested approach |
|---|---|---|
| **Launchpad loads repos sequentially, not concurrently** — `LaunchpadViewProvider.ts:150`, `for (const { repo, detected, repoRoot } of repos) { … await resolveForgeToken … await client.getAuthenticatedLogin() … await Promise.all([listOpenPullRequests, listRecentlyClosedPullRequests]) … }` | Launchpad's entire purpose is "across the workspace's repos" (§7 Phase 7) — a workspace with 8 repos across 3 hosts pays the sum of every host's round trips (auth check + 2 list calls each) instead of the max. This is the one place the codebase's otherwise-consistent parallelism discipline (seen in `CommitGraphViewProvider`'s `Promise.all`) doesn't hold | Change the `for...of` to `Promise.allSettled` over `repos`, pushing into `errors`/`categorized` from each settled result instead of accumulating inside a sequential loop. Must stay `allSettled` (not `all`) — one host being down must not blank the whole board, matching the existing per-repo `try/catch` behavior |
| **Everything else checked out clean, no action** | Blame debounce/cache, `--numstat` batching, and `Promise.all` elsewhere already meet the stated budgets; CodeLens providers delegate to the same cached `BlameSource` rather than re-spawning `git blame`, so no separate debounce bug exists there | — |

*Edge-case check:* the Launchpad fix holds at scale precisely because it removes a linear-in-repo-count wait, which only gets worse as workspace size grows — it doesn't depend on `maxGraphItems`/`maxHistoryItems`/`maxBlameFileSize` since those bound single-repo git output, a separate axis.

---

## Track 4 — Memory

| Finding | Why it matters | Suggested approach |
|---|---|---|
| **No leak found — say so plainly rather than inventing one** | Checked: `LruCache` instances are all size-bounded (50/50/50/200) with correct LRU eviction; `BlameSource`'s cache is watcher-invalidated (not just size-capped); the three `aiSummaryCache` instances (Commit Details, Branch Comparison, PR Details) key on immutable content (a commit/PR's diff never changes), so a size cap alone is correct there, no watcher needed; no `setInterval`/polling exists anywhere (Launchpad refreshes on-demand only); webview `dispose()` methods dispose their panels, which cascades VS Code's own `onDidDispose` cleanup | No action. If a real leak surfaces later, profile it — don't preemptively add disposal ceremony for a problem that isn't observed |

---

## Track 5 — Visual / animation polish

| Finding | Why it matters | Suggested approach | `prefers-reduced-motion` fallback |
|---|---|---|---|---|
| **`.gitlore-enter` (the shared 180ms entrance keyframe) is applied inconsistently** — used on Launchpad's `.pr-card`, PR Details' `.thread`, and tooltips in CommitGraph/VisualFileHistory, but **not** on CommitGraph's own commit rows, RebaseEditor's `.rb-row`, or VisualFileHistory's bubbles | The infrastructure already exists and is exactly right (one reusable class, not a new animation system) — it's just not applied everywhere new rows appear, so "Load More" in Commit Graph and initial render in Rebase Editor snap in instead of matching the polish Launchpad already has | Add the `gitlore-enter` class to the row templates in `CommitGraph/render.ts`, `RebaseEditor/render.ts`, and `VisualFileHistory/render.ts` — zero new CSS, reuse only | Already handled globally — `.gitlore-enter`'s keyframe is covered by each file's existing blanket `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }` rule |
| **RebaseEditor drag-reorder has no FLIP transition** — `.rb-row[draggable='true']` / `.rb-dragging` only lift the dragged row (`transform: translateY(-1px)`); the *other* rows that shift position on drop snap instantly instead of sliding | Small, contained polish — drag-reorder is the one interaction in the whole extension where rows visibly change position, and it's the one place without a settle animation | On drop, capture each row's pre/post `getBoundingClientRect()`, apply the delta as a `transform`, then transition it to `none` over `var(--gitlore-motion)` (classic FLIP) — no new dependency, ~15 lines in the existing webview script | Skip the whole FLIP calculation when `matchMedia('(prefers-reduced-motion: reduce)').matches` — rows just reorder instantly, which is the correct reduced-motion behavior, not a slowed-down version |

---

## Top 5 highest-leverage next moves

1. **Sidebar Explorer read/write parity** (Track 1) — one cohesive feature (delete branch/tag, rename branch, worktree add/remove, stash create) that closes the single most visible gap in the newest, most-used view container, using UI surface that already exists. Beats everything else on user-visible impact per line of code.
2. **`.git-blame-ignore-revs` support** (Track 1) — the highest value-to-effort ratio in this entire audit: one `if` + one flag in `blameFile`, no setting, no UI, and it's the single feature people specifically go looking for in a blame tool.
3. **Launchpad concurrent repo loading** (Track 3) — the only real performance bug found, and it's a `for` → `Promise.allSettled` change, not a rewrite. Directly serves Launchpad's own stated purpose (multi-repo triage).
4. **`GitService` internal decomposition** (Track 2) — highest risk-adjusted architectural payoff: reduces the graph's single largest blast radius without touching a single call site, because the facade contract (§10) is preserved.
5. **Apply `.gitlore-enter` consistently** (Track 5) — smallest item on this list, but it's the cheapest possible visual-consistency win because the mechanism already exists everywhere else; skipping it would mean recommending a new animation system instead of finishing the one already built.

*Reflog recovery and the Fetch button (both Track 1) are real and low-risk but ranked below these five — they're additive features with no existing gap to close, versus the above five which each fix an asymmetry or bug already present in shipped code.*
