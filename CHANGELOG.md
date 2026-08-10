# Changelog

All notable changes to GitSense are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Project scaffold (esbuild, TypeScript strict, eslint, unit + integration test harness).
- Inline blame: current-line author/age shown as a muted, right-aligned editor decoration, updating on line change only. Respects `blame.enabled`, `blame.format`, `blame.highlightCurrentLine`, `blame.ignoreWhitespace`, `maxBlameFileSize`. `GitSense: Toggle Inline Blame` command.
- Core git layer (`GitService`, `git blame --line-porcelain` parser), LRU cache, and a deterministic fixture-repo generator for tests.
- Blame hover card: author Gravatar, full commit message, relative + absolute date, diff stat, short SHA. Shares a single blame cache (`BlameSource`) with the inline decoration so a file is never blamed twice.
- `GitService.getFileDiffStat` + `git show --numstat` parser for the hover's diff stat.
- File history: `GitSense: Show File History` opens a TreeView (Explorer sidebar) listing every commit touching the current file, newest first, following the active editor. Respects `maxHistoryItems`. `GitService.getFileHistory` + `git log --follow` parser.
- Commit details: `GitSense: Show Commit Details` opens a webview with the full commit message, author, files changed (insertions/deletions), and the full unified diff. Strict CSP (no `unsafe-inline`), HTML-escaped commit-sourced content. Clicking a File History entry opens it directly; `Copy Commit SHA` moved to its right-click context menu. `GitService.getCommit`/`getCommitDiff`/`getCommitFiles`.
- Branch comparison: `GitSense: Compare Branches` prompts for a base and a compare branch, then opens a webview with commits ahead/behind, files changed, and the full diff against their merge-base (GitHub/GitLab PR-diff semantics). `GitService.getBranches`/`getCommitsBetween`/`getDiffBetweenRefs`/`getFilesBetweenRefs`.
- Issue/PR linking: references like `#123` in commit messages become clickable links in the blame hover (markdown) and commit details (HTML) webview. Auto-detects a GitHub/GitLab issue URL from the repo's git remote, or fully configurable (`issueLinking.enabled`/`.pattern`/`.urlTemplate`) for other trackers. Invalid regex in the pattern setting falls back to plain text rather than breaking the view. This completes Phase 3.

### Changed
- Visual redesign of all 4 views for closer parity with a native, polished look: Commit Graph now lays out each row as its own small SVG in normal flow (fixing the near-zero margin/overlap on single-lane graphs) with theme-aware lane colors (`--vscode-charts-*`), a per-row author avatar, and capped ref badges (`+N` overflow); Commit Details gained an avatar header, a dedicated SHA/copy toolbar, and small inline section icons; File History's tooltip now shows the author's avatar and full message/date, matching the hover card's richness; Branch Comparison gained per-commit avatars and matching section icons. Commit Details and Branch Comparison webviews now allow `https:` images in their CSP (for Gravatar), matching Commit Graph and the blame hover.
