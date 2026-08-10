# GitSense — Claude Code System Prompt

## Who you are working with

You are building **GitSense**, an open-source VS Code extension that makes deep sense of any Git repository — its history, authors, blame, branches, and commit patterns — directly inside the editor. Think of it as a leaner, smarter, fully free alternative to GitLens.

The developer is **Raj**, a full-stack developer based in India, working primarily in TypeScript and React. He uses a MacBook Pro (M3 Pro), VS Code / Cursor, and is experienced with monorepos, SDK architecture, and cross-platform tooling.

---

## Project identity

| Field        | Value                                              |
|--------------|----------------------------------------------------|
| Name         | GitSense                                           |
| Tagline      | *Makes sense of your repo.*                        |
| Type         | VS Code Extension (open source)                    |
| Language     | TypeScript                                         |
| License      | MIT                                                |
| Target       | VS Code 1.85+ and VS Code-based editors (Cursor)   |
| Package name | `gitsense`                                         |
| Publisher ID | (to be set in `package.json`)                      |

---

## Core philosophy — never compromise on these

1. **100% free, always.** No paywalled features, no "Pro" tier, no telemetry by default.
2. **Fast first.** Every feature must load lazily. The extension must not block editor startup. Startup contribution time target: < 50ms.
3. **Minimal surface area.** Only add a UI element if it earns its place. No sidebars full of empty sections.
4. **AI-native, not AI-bolted-on.** AI features are first-class, not an afterthought. Use the VS Code Language Model API (`vscode.lm`) so users can plug in any LLM (Copilot, Ollama, Claude, etc.).
5. **Respect the editor.** Use native VS Code APIs — CodeLens, Decorations, TreeView, Webview — instead of reinventing UI primitives.

---

## Tech stack

```
/
├── src/
│   ├── extension.ts          # Entry point — activate() and deactivate()
│   ├── core/                 # Pure business logic, no VS Code deps
│   │   ├── git/              # Git parsing: log, blame, diff, refs
│   │   ├── cache/             # In-memory LRU cache for git output
│   │   └── ai/                # LLM prompt builders + response parsers
│   ├── providers/            # VS Code API implementations
│   │   ├── BlameProvider.ts  # Inline blame decorations
│   │   ├── CodeLensProvider.ts
│   │   ├── HoverProvider.ts
│   │   └── TreeProvider.ts   # Sidebar tree views
│   ├── views/                # Webview panels (rich UI)
│   │   ├── CommitGraph/      # Visual commit graph
│   │   └── FileHistory/      # Per-file timeline
│   ├── commands/             # All vscode.commands.registerCommand handlers
│   └── utils/                # Shared helpers (date, string, path)
├── test/
├── package.json              # Extension manifest
└── CLAUDE.md                 # ← this file
```

### Key dependencies

| Package | Purpose |
|---|---|
| `simple-git` | Programmatic Git CLI wrapper |
| `date-fns` | Lightweight date formatting |
| `@vscode/test-electron` | Extension integration tests |
| `esbuild` | Fast bundler (not webpack) |

Do **not** add React/Vue/Svelte to the core extension runtime — webviews use vanilla TS + CSS. Only introduce a framework if a view becomes complex enough to justify it, and isolate it inside its own `views/` subdirectory.

---

## Git interaction rules

- Always use `simple-git` for git operations — never shell out with `child_process.exec` directly.
- Parse git output through dedicated parser functions in `src/core/git/` — keep parsing logic out of providers.
- Cache git results aggressively using the LRU cache in `src/core/cache/`. Key: `${repoRoot}:${filePath}:${ref}`.
- Watch for file system changes with `vscode.workspace.createFileSystemWatcher` to invalidate cache entries, not polling.
- Always handle the case where no git repo is open — extension must degrade gracefully.

---

## Features roadmap (priority order)

### Phase 1 — Core (MVP)
- [ ] **Inline blame** — current-line blame shown as an editor decoration (muted, right-aligned)
- [ ] **Blame hover card** — hover over blame text → rich card: author avatar (Gravatar), full message, date, diff stat
- [ ] **File history panel** — timeline of all commits that touched the current file
- [ ] **Commit details panel** — full commit view: message, diff, files changed
- [ ] **Status bar item** — shows current line's last commit author + age

### Phase 2 — Intelligence
- [ ] **AI commit summary** — uses `vscode.lm` to summarize what a commit does in plain English
- [ ] **AI blame explanation** — "Why was this line changed?" answered by LLM with the diff as context
- [ ] **Stale code detector** — flag files/functions not touched in N months
- [ ] **Author heatmap** — who owns what, visualized per-file

### Phase 3 — Graph & Collaboration
- [ ] **Visual commit graph** — interactive DAG in a Webview panel
- [ ] **Branch comparison** — diff two branches side-by-side
- [ ] **PR/issue linking** — auto-link commit messages to GitHub/GitLab issues (configurable pattern)

---

## Commands (register all in `package.json` > `contributes.commands`)

| Command ID | Title |
|---|---|
| `gitsense.toggleBlame` | GitSense: Toggle Inline Blame |
| `gitsense.showFileHistory` | GitSense: Show File History |
| `gitsense.showCommit` | GitSense: Show Commit Details |
| `gitsense.explainCommit` | GitSense: Explain Commit with AI |
| `gitsense.explainLine` | GitSense: Explain This Line's History |
| `gitsense.openGraph` | GitSense: Open Commit Graph |

---

## Configuration (`package.json` > `contributes.configuration`)

All settings live under the `gitsense.*` namespace.

| Setting | Type | Default | Description |
|---|---|---|---|
| `gitsense.blame.enabled` | boolean | `true` | Show inline blame decorations |
| `gitsense.blame.format` | string | `"{author}, {age}"` | Format string for blame text |
| `gitsense.blame.highlightCurrentLine` | boolean | `true` | Highlight the current line's blame |
| `gitsense.ai.enabled` | boolean | `false` | Enable AI-powered features |
| `gitsense.ai.model` | string | `"default"` | LLM model family hint for `vscode.lm` |
| `gitsense.staleThresholdDays` | number | `180` | Days before a file is considered stale |
| `gitsense.maxHistoryItems` | number | `200` | Max commits to load in file history |

---

## Code conventions

- **TypeScript strict mode on.** No `any`, no `!` non-null assertions without a comment explaining why.
- **Async/await everywhere.** Never use raw `.then()` chains.
- **Error handling:** Wrap all git calls and LLM calls in try/catch. Surface errors via `vscode.window.showErrorMessage` — never silently swallow.
- **Disposables:** Every `vscode.Disposable` created in `activate()` must be pushed to `context.subscriptions`. No memory leaks.
- **Naming:**
  - Providers: `XProvider` (implement the VS Code provider interface)
  - Commands: `handleXCommand` (functions registered with `registerCommand`)
  - Git parsers: `parseX` (pure functions, no side effects)
- **No classes for simple utilities** — prefer plain functions exported from a module.
- **Test coverage target:** 80% for `src/core/` (pure logic). Providers and commands are tested via integration tests.

---

## Performance rules

- The `activate()` function must return in < 50ms. Defer all git operations using `setImmediate` or lazy registration.
- Never call git on every keystroke. Debounce document change listeners with a 500ms delay.
- Inline blame decorations must not recompute on every cursor move — only on line change.
- Webview panels must use `retainContextWhenHidden: false` unless state preservation is explicitly required.

---

## Build & dev commands

```bash
npm install           # install deps
npm run compile       # tsc + esbuild bundle
npm run watch         # watch mode for development
npm run test          # run tests with @vscode/test-electron
npm run lint          # eslint
npm run package       # produces gitsense-x.x.x.vsix
```

Press `F5` in VS Code to launch the Extension Development Host.

---

## What NOT to do (lessons from GitLens)

- **Do not gate any feature behind a sign-in or account.** If a feature requires an API key (e.g., AI), ask the user to provide it via VS Code settings — never route it through a backend.
- **Do not add a sidebar view with 10 empty sections.** Only register a TreeView if it has content to show.
- **Do not bundle a full Webpack config** — use esbuild for speed.
- **Do not ship telemetry enabled by default.** If added, it must be opt-in with explicit user consent.
- **Do not add animations or transitions** to editor decorations — they cause flicker and feel janky.
- **Do not load the entire git log on activation** — load on demand per-file.

---

## When you're unsure

1. Check the [VS Code Extension API docs](https://code.visualstudio.com/api) first.
2. Prefer the simplest implementation that works — optimize only after profiling.
3. Ask Raj before adding a new dependency. Keep `node_modules` lean.
4. If a feature would require a backend service, flag it — GitSense is designed to run fully locally.
