<div align="center">

<img src="media/icon.png" width="112" alt="" />

# GitLore

**The story behind every line.**

Free, local-first git insight inside VS Code — blame, history, an interactive commit graph,
and branch comparison. No account, no paywall, no telemetry, no backend.

</div>

---

## What is this?

Open any file in any git repo and GitLore answers the question you actually have: **who wrote this line, when, why, and what else changed with it.**

It does that without leaving your editor, without signing in, and without sending your code anywhere. Everything runs against the `git` binary already on your machine.

If you've used similar VS Code git extensions, GitLore covers the same core ground — inline blame, a commit graph, commit details, branch comparison — with every feature free and a deliberately smaller surface area. See [How it compares](#how-it-compares).

> **Status: early but stable-channel.** Everything below works and is covered by tests — 495 unit tests and 91 integration tests against a real VS Code instance. It is still `0.x`, so expect breaking changes before `1.0`. Bug reports are very welcome.

## Install

**From the Marketplace** — search *GitLore* in the Extensions view (`⇧⌘X` / `Ctrl+Shift+X`) and click Install. Or from the command line:

```bash
code --install-extension RajpratapsinghJadon.gitlore
```

**From a `.vsix`** — grab one from [Releases](https://github.com/rajjadon/gitlore/releases), then:

```bash
code --install-extension gitlore-0.3.1.vsix
```

Requires **VS Code 1.85+** and `git` on your `PATH`. Works in Cursor and other VS Code-based editors.

## Getting started in 60 seconds

1. **Open a file in a git repo.** The current line's author and age appear at the end of the line, and in the status bar.
2. **Hover that line** for the full commit message, dates, and the diff stat.
3. **Open the panel** — `⌘J` / `Ctrl+J`, then pick the **GitLore** tab (next to Terminal and Output). The commit graph loads itself.
4. **Click any commit row.** Its details load in the pane beside the graph — every changed file, collapsible, with a real diff gutter.
5. **Everything else is a button** in each view's title bar. You never need the command palette.

## Features

### Inline blame, where you're already looking

<img src="media/screenshots/inline-blame.png" width="470" alt="Inline blame decoration at the end of the current line, with the hover card open showing author, message and dates" />

The current line's author and age, as a muted end-of-line decoration. It updates when you change lines — not on every cursor move — and the hover card adds the full message, relative *and* absolute dates, that commit's diff stat for this file, and the short SHA. Customise the text with `gitLore.blame.format`, or turn it off entirely.

The hover card also has **Compare** / **File History** / **Copy SHA** quick actions, and an **Older** link that steps backward through that exact line's own history (real per-line tracking, not just "commits that touched this file") — ◀ prev / next ▶ through every revision that changed the line, without leaving the hover.

### An interactive commit graph, in the panel

<img src="media/screenshots/commit-graph.png" alt="The GitLore panel showing the commit graph with branch labels, a working-changes row, and commit details beside it" />

A repo-wide, branch-and-merge-aware graph — not a flat log. Branch, tag and remote-tracking labels are each styled distinctly, uncommitted work is pinned at the top as a **Working Changes** row, and the toolbar lets you scope to one branch, filter by message/author/SHA as you type, and refresh. Arrow keys move the selection; Enter opens the commit.

Pull and push buttons sit in the toolbar too, badged with how many commits you're behind/ahead of the upstream (hidden when there's no upstream to compare against) — both run in a real terminal, so you see prompts and conflicts instead of them failing silently. The graph also auto-refreshes on any external `git pull`/push/checkout, not just its own buttons.

### Commit details you can act on

<img src="media/screenshots/commit-details.png" alt="Commit details showing the action bar and a per-file collapsible diff with old and new line numbers in a gutter" />

Each changed file is its own collapsible section holding only that file's hunks, with a filter box for large commits. Diffs show **old and new line numbers in a gutter** and tint changed lines, so you can see *which* line moved — and line numbers stay out of your text selection, so copying a diff gives you just the code.

**Copy SHA**, **Copy message**, and **Open on GitHub/GitLab/Bitbucket** sit in the action bar. **Open changes** on any file row hands off to a real diff editor when you want syntax highlighting and folding.

### Branch comparison without modal prompts

<img src="media/screenshots/branch-comparison.png" alt="Branch comparison showing two ref pickers with a swap button and Ahead, Behind and All Files tabs with counts" />

Two ref pickers with a swap button, and **Ahead / Behind / All Files** tabs with counts. It opens on your current branch versus its upstream, so it's useful immediately — retarget either side in place. Diffs are taken against the merge-base, matching what a GitHub or GitLab pull request shows you.

**Create PR** opens your host's compare/create-PR page pre-filled with both branches (GitHub, GitLab, Bitbucket — hidden on hosts GitLore doesn't recognize, rather than guessing a URL that might 404). **Open all changes** opens every changed file's diff at once instead of one at a time, all against the same common base.

### Launchpad — a cross-repo PR triage board (off by default)

The only GitLore feature that reaches beyond your local `.git` — everything else above works fully offline. **GitLore: Open Launchpad** opens a 6-column board (Needs Review, Ready to Merge, Waiting, Blocked, Drafts, Snoozed) pooling open PRs across every recognized remote in your workspace, so triaging what needs your attention doesn't mean tab-switching between repos and a browser.

Not GitHub-only: GitHub, GitLab, Bitbucket, and Azure DevOps are supported out of the box, plus self-hosted or custom instances (GitHub Enterprise Server, Gitea, Forgejo, self-hosted GitLab) via `gitLore.launchpad.customHosts`. GitHub uses VS Code's own built-in sign-in; every other host needs a Personal Access Token, entered once and stored in VS Code's encrypted secret storage — never a GitLore backend, never a key GitLore itself handles.

Off by default (`gitLore.launchpad.enabled`) — it's opt-in, same as AI, since it's the one feature that calls out to a remote host at all.

### Also

- **File history** — every commit that touched the current file, following renames, in the Explorer.
- **Visual File History** — an author-swimlane bubble timeline of the current file: commit size, age, and additions/deletions at a glance, in the panel.
- **Issue and PR links** — `#123` in a commit message becomes a link, auto-detected from your remote or pointed at any tracker (Jira included) via a regex and URL template.
- **Stale-code detector** — a CodeLens above functions and methods untouched for longer than `gitLore.staleThresholdDays`, linking straight to the commit that last changed them.
- **Author ownership heatmap** — an overview-ruler color mark per line, by that line's author (`gitLore.ownership.enabled`, off by default), plus **GitLore: Show File Ownership** for a recency-weighted breakdown of who owns the file.
- **Full-file blame heatmap** — a hot-to-cold recency gradient as a left-edge mark per line, across the whole file (`gitLore.fullFileBlame.enabled`, off by default) — distinct from the current-line decoration and the ownership ruler above.
- **Interactive Rebase Editor** — reorder, reword, edit, squash, fixup, or drop commits with a real UI instead of hand-editing the `git rebase -i` todo file. **GitLore: Rebase Branch Interactively...** starts one, or it just works if you already use `code --wait` as your `sequence.editor`. GitLore never runs `rebase`/`--abort`/`--continue` itself — only reads, writes, and closes the file git already opens.
- **Sidebar Explorer** — Branches, Remotes, Tags, Stashes, Worktrees, and Contributors in one always-visible tree, in its own activity bar icon. Checkout or compare a branch, open a remote in your browser, apply or drop a stash, all from the right-click menu.

## Commands

Every command is also a title-bar button in the GitLore panel.

| Command | What it does |
|---|---|
| `GitLore: Open Commit Graph` | Reveal the panel and load the repo's graph |
| `GitLore: Show Commit Details` | Load a commit into the details pane |
| `GitLore: Compare Branches` | Compare two refs, ahead/behind/files |
| `GitLore: Show File History` | List commits touching the current file |
| `GitLore: Show Visual File History` | Open the bubble timeline for the current file |
| `GitLore: Toggle Inline Blame` | Turn the end-of-line decoration on or off |
| `GitLore: Copy Commit SHA` | Copy a commit's full SHA (from a commit's context menu) |
| `GitLore: Show File Ownership` | See a file's authors ranked by recency-weighted ownership share (command palette only, no title-bar button) |
| `GitLore: Rebase Branch Interactively...` | Pick a target ref and start an interactive rebase, opened in GitLore's own editor |
| `GitLore: Checkout Branch` | Check out the selected branch (from the Explorer's context menu) |
| `GitLore: Compare with Current Branch` | Open Branch Comparison against the selected branch (from the Explorer's context menu) |
| `GitLore: Open Remote in Browser` | Open the selected remote's repo page (from the Explorer's context menu) |
| `GitLore: Apply Stash` | Re-apply the selected stash without dropping it (from the Explorer's context menu) |
| `GitLore: Drop Stash` | Permanently delete the selected stash, after confirming (from the Explorer's context menu) |
| `GitLore: Step Through This Line's History` | Move the hover's line-history stepper (from the hover's Older/prev/next links) |
| `GitLore: Toggle Full-File Blame Heatmap` | Turn the whole-file recency gradient on or off |
| `GitLore: Open Launchpad` | Open the cross-repo PR triage board (needs `gitLore.launchpad.enabled`) |

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `gitLore.blame.enabled` | boolean | `true` | Show inline blame decorations, hover cards, and the status bar item. |
| `gitLore.blame.format` | string | `"{author}, {age}"` | Template for the inline blame text. Tokens: `{author} {age} {date} {message} {sha}` |
| `gitLore.blame.highlightCurrentLine` | boolean | `true` | Highlight the current line's blame decoration. |
| `gitLore.blame.ignoreWhitespace` | boolean | `true` | Pass `-w` to git blame to ignore whitespace-only changes. |
| `gitLore.maxBlameFileSize` | number | `1048576` | Skip blame for files larger than this size, in bytes. |
| `gitLore.maxHistoryItems` | number | `200` | Max commits loaded per file history. |
| `gitLore.maxGraphItems` | number | `200` | Max commits loaded in the commit graph. |
| `gitLore.staleCode.enabled` | boolean | `true` | Show a CodeLens above functions and methods that haven't changed in longer than staleThresholdDays. |
| `gitLore.staleThresholdDays` | number | `180` | Days since a function's or method's last change before it's flagged as stale. |
| `gitLore.ownership.enabled` | boolean | `false` | Show a color mark per line in the editor's overview ruler for that line's author. |
| `gitLore.fullFileBlame.enabled` | boolean | `false` | Show a hot-to-cold recency gradient as a left-edge mark per line, across the whole file. |
| `gitLore.issueLinking.enabled` | boolean | `true` | Auto-link issue/PR references in commit messages. |
| `gitLore.issueLinking.pattern` | string | `"#(\\d+)"` | Regex matching issue references. The first capture group (or the whole match) fills `{issue}` in the URL template. |
| `gitLore.issueLinking.urlTemplate` | string | `""` | `{issue}`-templated issue URL. Empty = auto-detect from the repo's GitHub/GitLab remote. |
| `gitLore.launchpad.enabled` | boolean | `false` | Enable Launchpad, the cross-repo PR triage board. The only setting that makes GitLore call out to a remote host. |
| `gitLore.launchpad.customHosts` | array | `[]` | Self-hosted/custom git-forge instances (GitHub Enterprise Server, Gitea, Forgejo, self-hosted GitLab) Launchpad can't recognize by hostname alone. Each entry: `{ hostname, flavor, apiBaseUrl }`. |

## Privacy

GitLore runs entirely locally. Your git data never leaves your machine.

The one network request it makes on its own: author avatars from `gravatar.com`, keyed by an MD5 hash of the commit email — that's Gravatar's own lookup spec, not a security-relevant use of the hash.

A few things open your browser, and only when you click them: **Open on GitHub/GitLab/Bitbucket**, **Create PR**, **Open Remote in Browser**, and issue links. Every one of those URLs is built locally from your git remote; GitLore doesn't contact the host to construct them.

**Launchpad is the one exception to "everything is local"** — it's off by default (`gitLore.launchpad.enabled`), and only fetches PR data from hosts you've explicitly authenticated with (VS Code's own GitHub sign-in, or a Personal Access Token you provide for anything else, stored in VS Code's encrypted secret storage). No GitLore backend ever sees your code, your token, or your PR data — GitLore talks directly to the host you configured.

No telemetry. No analytics. No account.

## How it compares

GitLore is not trying to out-feature the bigger, paid alternatives — it's trying to be the free, fast, small part you actually use every day. Honest accounting:

**What GitLore does** — inline blame and hover, status bar, file history, commit graph, commit details with per-file diffs, AI commit summaries, AI line explanations, branch comparison, issue linking. All free, forever.

**What it deliberately doesn't** — staging, stashing or committing (that's VS Code's own Source Control view, and the graph links you there), and anything behind a sign-in.

**What's missing for now** — a file-tree view of changed files, and graph auto-refresh. See the [changelog](CHANGELOG.md) for the current list.

## Contributing

```bash
npm install
npm run watch     # rebuild on change
npm run lint      # eslint + tsc --noEmit
npm run test      # unit + integration
```

Press `F5` to launch the Extension Development Host with GitLore loaded.

- `npm run test:unit` runs just the fast, VS Code-free tests over `src/core` and the renderers.
- `npm run package` builds a `.vsix`; `npm run package:pre` builds a pre-release one.
- `npm run icon` re-renders `media/icon.png` from `media/icon.svg` (needs `rsvg-convert`).

Architecture, conventions and the roadmap live in [`CLAUDE.md`](CLAUDE.md). The short version: `src/core/` is pure logic with zero `vscode` imports and is unit-tested in isolation; everything VS Code-facing sits in `providers/`, `views/` and `commands/`.

## License

[MIT](LICENSE) — free, forever, no exceptions.
