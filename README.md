# GitSense

*Makes sense of your repo.*

GitSense is a free, open-source (MIT) VS Code extension that surfaces git blame, history, and authorship directly in the editor — a leaner, fully local alternative to GitLens. No paywalls, no account, no telemetry by default, no backend.

## Status

Phase 1 (MVP) and Phase 3 (commit graph, branch comparison, issue/PR linking) are complete. AI features (Phase 2) are next — see `CLAUDE.md` for the full roadmap.

## Features

- **Inline blame** — the current line's author and age, shown as a muted, right-aligned editor decoration. Updates when you move to a different line, not on every cursor move. Toggle with **GitSense: Toggle Inline Blame**.
- **Blame hover card** — hover any line to see the author's Gravatar, full commit message, relative + absolute date, diff stat, and short SHA.
- **File history** — run **GitSense: Show File History** to open a sidebar view listing every commit that touched the current file, newest first, following the active editor as you switch files. Click an entry to open its commit details; right-click for **Copy Commit SHA**.
- **Commit details**, **Commit graph**, and **Branch comparison** all live in a single "GitSense" tab in the bottom panel (next to Terminal/Debug Console/Output/Ports) — never an editor tab.
  - **GitSense: Open Commit Graph** — a repo-wide, branch-and-merge-aware graph laid out in seven columns (Branch/Tag, Graph, Commit Message, Author, Changes, Commit Date, SHA), with a toolbar for filtering: a branch picker to scope the graph to one ref, an instant text filter across message/author/SHA, a live commit count, and a refresh button. Local branches, the checked-out branch, remote-tracking branches and tags each get their own label style and icon. Uncommitted work is pinned as a **Working Changes** row above the newest commit with `+added ~modified −deleted` file counts — click it to jump to the Source Control view. Arrow keys move the selection, Enter loads the commit; the selected row survives a refresh.
  - **GitSense: Show Commit Details** (or clicking a graph row or File History entry) — the commit's subject, author, date and SHA in a compact header, then every changed file as a **collapsible section holding only that file's hunks**, with a filter box, per-file insertion/deletion counts, and whole-commit totals.
  - **GitSense: Compare Branches** — commits ahead/behind between two branches, files changed, and the full diff against their merge-base (like a GitHub/GitLab PR diff); click a commit there to load its details too.
- **Status bar** — the current line's author and age in the status bar, mirroring the inline decoration. Click it to open commit details.
- **Issue/PR linking** — references like `#123` in commit messages become clickable links (in the blame hover and commit details) to your issue tracker. Auto-detected from the repo's GitHub/GitLab remote, or fully configurable for other trackers (e.g. Jira).

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `gitsense.blame.enabled` | boolean | `true` | Show inline blame decorations, hover cards, and the status bar item. |
| `gitsense.blame.format` | string | `"{author}, {age}"` | Template for the inline blame text. Tokens: `{author} {age} {date} {message} {sha}` |
| `gitsense.blame.highlightCurrentLine` | boolean | `true` | Highlight the current line's blame decoration. |
| `gitsense.blame.ignoreWhitespace` | boolean | `true` | Pass `-w` to git blame to ignore whitespace-only changes. |
| `gitsense.maxBlameFileSize` | number | `1048576` | Skip blame for files larger than this size, in bytes. |
| `gitsense.maxHistoryItems` | number | `200` | Max commits loaded per file history. |
| `gitsense.maxGraphItems` | number | `200` | Max commits loaded in the commit graph. |
| `gitsense.issueLinking.enabled` | boolean | `true` | Auto-link issue/PR references in commit messages. |
| `gitsense.issueLinking.pattern` | string | `"#(\\d+)"` | Regex matching issue references. The first capture group (or the whole match) fills `{issue}` in the URL template. |
| `gitsense.issueLinking.urlTemplate` | string | `""` | `{issue}`-templated issue URL. Empty = auto-detect from the repo's GitHub/GitLab remote. |

## Privacy

GitSense runs entirely locally. Git data never leaves your machine. The one exception: the blame hover card, Commit Graph, Commit Details, and Branch Comparison views fetch a Gravatar image from `gravatar.com` per author, keyed by an MD5 hash of their email (that's Gravatar's own lookup spec, not a security-relevant use of the hash). No other network calls are made.

## Development

```bash
npm install
npm run compile
npm run watch
npm run test
npm run lint
npm run package
```

Press `F5` to launch the Extension Development Host.

## License

MIT
