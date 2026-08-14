# Screenshots

Every screenshot here is **generated**, not captured by hand — two scripts, split by what they can
reach:

- **`npm run shots`** (`scripts/shoot-screenshots.ts`) covers the webview panels. `src/core/` has no
  `vscode` imports and the view renderers are pure functions, so the exact HTML a webview would show
  can be produced in plain Node against this repo's own git history (or, for Launchpad, realistic
  sample data — see below), then photographed with headless Chrome.
- **`npm run shots:native`** (`scripts/shoot-native-screenshots.ts`) covers everything that isn't a
  webview — an editor decoration, a CodeLens, a TreeView, an overview-ruler mark — none of which have
  HTML to render outside VS Code itself. This one drives an actual VS Code window via Playwright's
  Electron support (`_electron.launch`), pointed at the same `.vscode-test`-cached binary the
  integration tests use, against `scripts/build-demo-repo.ts` — a small, realistic, multi-author demo
  repo built specifically for this (the `test/fixtures/` repos optimize for deterministic assertions,
  not something worth looking at — "alice line one" placeholder text and all).

Re-run the relevant one after any UI change instead of re-shooting by hand.

| File | Script |
|---|---|
| `commit-graph.png` | `npm run shots` |
| `commit-details.png` | `npm run shots` |
| `branch-comparison.png` | `npm run shots` |
| `visual-file-history.png` | `npm run shots` |
| `rebase-editor.png` | `npm run shots` |
| `launchpad.png` | `npm run shots` (sample data — see below) |
| `pull-request-details.png` | `npm run shots` (title/files/diff are real, reused from the commit-details shot; the review conversations are sample data — see below) |
| `inline-blame.png` | `npm run shots:native` |
| `file-history.png` | `npm run shots:native` |
| `sidebar-explorer.png` | `npm run shots:native` |
| `stale-code.png` | `npm run shots:native` |
| `full-file-blame.png` | `npm run shots:native` |
| `ownership-heatmap.png` | `npm run shots:native` |

Two things worth knowing about what's *not* 100% real:

1. **The theme.** VS Code injects ~100 `--vscode-*` custom properties into every webview; `shoot-screenshots.ts` approximates Dark Modern for the headless-Chrome renders. `shoot-native-screenshots.ts` doesn't have this problem — it's real VS Code, so the theme is exactly whatever the demo profile's default is.
2. **Launchpad's data.** It pools PRs from real, authenticated remote hosts — there's nothing to render without a live network call and real credentials, so `launchpad.png` is built from realistic hand-written sample data instead of this repo's own history. Same reason `pull-request-details.png`'s review conversations are sample data — the PR title, changed files, and diff underneath them are real (reused from the commit-details shot) so nothing on screen contradicts the diff actually shown. Every other screenshot is this repo's real commits, real authors, real dates (or the demo repo's, for the native ones).

## Why a separate demo repo for the native shots

`scripts/build-demo-repo.ts` builds a small multi-author repo with a deliberately wide commit-date
spread — some commits ~14 months old, some from today — so the stale-code detector, the ownership
heatmap, and the full-file-blame gradient all have something real to show. This repo's own history
(single author, everything within the last few days) can't demonstrate any of those three
convincingly, which is exactly why a purpose-built repo exists rather than reusing it.

## Marketplace image URLs

The README's `<img>` tags use plain relative paths (`media/screenshots/...`) — don't rewrite these
to absolute URLs by hand. `vsce package`/`vsce publish` already does that automatically at package
time (confirmed by extracting a built `.vsix` and checking): it rewrites every relative link to
`https://github.com/rajjadon/gitlore/raw/HEAD/media/screenshots/...` using the `repository` field in
`package.json`, because the VS Code Marketplace itself doesn't resolve relative image paths — only
GitHub's own README rendering does. Screenshots are excluded from the `.vsix` on purpose (see
`.vscodeignore`): both GitHub and the Marketplace fetch them over HTTPS from the repo, so shipping
copies inside the package would only add weight — **the images 404 on both until they're pushed to
`master`.**

## Before regenerating

- Check for anything you don't want public: file paths, branch names, real commit messages, tokens
  in a visible `.env`. One of the earlier dev screenshots had `.env` contents on screen.
- If `scripts/build-demo-repo.ts`'s content changes, re-check that `shoot-native-screenshots.ts`'s
  hardcoded line numbers/text matchers (e.g. `goToLine(page, 8)`, the `hasText` filters) still point
  at the right lines.
