# GitSense

*Makes sense of your repo.*

GitSense is a free, open-source (MIT) VS Code extension that surfaces git blame, history, and authorship directly in the editor — a leaner, fully local alternative to GitLens. No paywalls, no account, no telemetry by default, no backend.

## Status

Phase 1 (MVP) is under active development. See `CLAUDE.md` for the full architecture and roadmap.

## Features

- **Inline blame** — the current line's author and age, shown as a muted, right-aligned editor decoration. Updates when you move to a different line, not on every cursor move. Toggle with **GitSense: Toggle Inline Blame**.

Still to come: blame hover card, file history, commit details, status bar (see `CLAUDE.md` for the roadmap).

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `gitsense.blame.enabled` | boolean | `true` | Show inline blame decorations, hover cards, and the status bar item. |
| `gitsense.blame.format` | string | `"{author}, {age}"` | Template for the inline blame text. Tokens: `{author} {age} {date} {message} {sha}` |
| `gitsense.blame.highlightCurrentLine` | boolean | `true` | Highlight the current line's blame decoration. |
| `gitsense.blame.ignoreWhitespace` | boolean | `true` | Pass `-w` to git blame to ignore whitespace-only changes. |
| `gitsense.maxBlameFileSize` | number | `1048576` | Skip blame for files larger than this size, in bytes. |

## Privacy

GitSense runs entirely locally. Git data never leaves your machine. Inline blame reads directly from your local git repository — no network calls. (The upcoming blame hover card will fetch a Gravatar image from `gravatar.com` using an MD5 hash of the commit author's email; this will be the one intentional exception, documented here when it ships.)

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
