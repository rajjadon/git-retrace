# Changelog

All notable changes to GitSense are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Project scaffold (esbuild, TypeScript strict, eslint, unit + integration test harness).
- Inline blame: current-line author/age shown as a muted, right-aligned editor decoration, updating on line change only. Respects `blame.enabled`, `blame.format`, `blame.highlightCurrentLine`, `blame.ignoreWhitespace`, `maxBlameFileSize`. `GitSense: Toggle Inline Blame` command.
- Core git layer (`GitService`, `git blame --line-porcelain` parser), LRU cache, and a deterministic fixture-repo generator for tests.
