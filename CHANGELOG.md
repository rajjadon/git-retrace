# Changelog

All notable changes to GitSense are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Project scaffold (esbuild, TypeScript strict, eslint, unit + integration test harness).
- Inline blame: current-line author/age shown as a muted, right-aligned editor decoration, updating on line change only. Respects `blame.enabled`, `blame.format`, `blame.highlightCurrentLine`, `blame.ignoreWhitespace`, `maxBlameFileSize`. `GitSense: Toggle Inline Blame` command.
- Core git layer (`GitService`, `git blame --line-porcelain` parser), LRU cache, and a deterministic fixture-repo generator for tests.
- Blame hover card: author Gravatar, full commit message, relative + absolute date, diff stat, short SHA. Shares a single blame cache (`BlameSource`) with the inline decoration so a file is never blamed twice.
- `GitService.getFileDiffStat` + `git show --numstat` parser for the hover's diff stat.
- File history: `GitSense: Show File History` opens a TreeView (Explorer sidebar) listing every commit touching the current file, newest first, following the active editor. Respects `maxHistoryItems`. Clicking an entry copies its SHA (`GitSense: Copy Commit SHA`). `GitService.getFileHistory` + `git log --follow` parser.
