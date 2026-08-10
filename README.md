# GitSense

*Makes sense of your repo.*

GitSense is a free, open-source (MIT) VS Code extension that surfaces git blame, history, and authorship directly in the editor — a leaner, fully local alternative to GitLens. No paywalls, no account, no telemetry by default, no backend.

## Status

Phase 1 (MVP) is under active development. See `CLAUDE.md` for the full architecture and roadmap.

## Features

- **Inline blame** — the current line's author and age, shown as a muted, right-aligned editor decoration. Updates when you move to a different line, not on every cursor move. Toggle with **GitSense: Toggle Inline Blame**.
- **Blame hover card** — hover any line to see the author's Gravatar, full commit message, relative + absolute date, diff stat, and short SHA.
- **File history** — run **GitSense: Show File History** to open a sidebar view listing every commit that touched the current file, newest first, following the active editor as you switch files. Click an entry to copy its SHA.

Still to come: commit details, status bar (see `CLAUDE.md` for the roadmap).

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `gitsense.blame.enabled` | boolean | `true` | Show inline blame decorations, hover cards, and the status bar item. |
| `gitsense.blame.format` | string | `"{author}, {age}"` | Template for the inline blame text. Tokens: `{author} {age} {date} {message} {sha}` |
| `gitsense.blame.highlightCurrentLine` | boolean | `true` | Highlight the current line's blame decoration. |
| `gitsense.blame.ignoreWhitespace` | boolean | `true` | Pass `-w` to git blame to ignore whitespace-only changes. |
| `gitsense.maxBlameFileSize` | number | `1048576` | Skip blame for files larger than this size, in bytes. |
| `gitsense.maxHistoryItems` | number | `200` | Max commits loaded per file history. |

## Privacy

GitSense runs entirely locally. Git data never leaves your machine. The one exception: the blame hover card fetches a Gravatar image from `gravatar.com`, keyed by an MD5 hash of the commit author's email (that's Gravatar's own lookup spec, not a security-relevant use of the hash). No other network calls are made.

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
