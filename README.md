# GitSense

*Makes sense of your repo.*

GitSense is a free, open-source (MIT) VS Code extension that surfaces git blame, history, and authorship directly in the editor — a leaner, fully local alternative to GitLens. No paywalls, no account, no telemetry by default, no backend.

## Status

Phase 1 (MVP) and Phase 3 (commit graph, branch comparison, issue/PR linking) are complete. AI features (Phase 2) are next — see `CLAUDE.md` for the full roadmap.

## Features

- **Inline blame** — the current line's author and age, shown as a muted, right-aligned editor decoration. Updates when you move to a different line, not on every cursor move. Toggle with **GitSense: Toggle Inline Blame**.
- **Blame hover card** — hover any line to see the author's Gravatar, full commit message, relative + absolute date, diff stat, and short SHA.
- **File history** — run **GitSense: Show File History** to open a sidebar view listing every commit that touched the current file, newest first, following the active editor as you switch files. Click an entry to open its commit details; right-click for **Copy Commit SHA**.
- **Commit details** — a webview with the full commit message, author, every changed file with insertion/deletion counts, and the full unified diff. Open it from File History, or via **GitSense: Show Commit Details**.
- **Status bar** — the current line's author and age in the status bar, mirroring the inline decoration. Click it to open commit details.
- **Commit graph** — run **GitSense: Open Commit Graph** for a repo-wide, branch-and-merge-aware graph of every commit across all refs, with branch/tag badges. Click a row to open its commit details.
- **Branch comparison** — run **GitSense: Compare Branches**, pick a base and a branch to compare, and see commits ahead/behind, files changed, and the full diff (against their merge-base, like a GitHub/GitLab PR diff). Click a commit to open its details.
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
