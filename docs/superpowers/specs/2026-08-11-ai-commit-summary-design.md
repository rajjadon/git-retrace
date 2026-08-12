# Phase 2, sub-project 1: AI layer + AI commit summary

## Context

Phase 1 shipped as `0.2.0` (blame, file history, commit graph, commit details,
branch comparison — all tested). Phase 2 adds four features per `CLAUDE.md`
§7: AI commit summary, AI line explanation, stale-code detector, author
ownership. The first two share a `vscode.lm` client; the last two don't touch
AI at all. This spec covers only the first slice: the AI client plus the
commit-summary feature. AI line explanation, stale-code detector, and author
ownership are separate specs.

`constants.ts` already reserves `COMMANDS.explainCommit` /
`COMMANDS.explainLine` ("Reserved for Phase 2 — not registered in
package.json yet"). No `core/ai/` or `src/ai/` exists yet.

## Decision: how users bring their own AI

GitLore only talks to models through `vscode.lm.selectChatModels()` — never
a stored API key, never a hardcoded provider, never a subprocess shelling out
to a CLI (e.g. `claude`, `codex`). This matches the existing hard rule in
`CLAUDE.md` §4/§11. Practically: any extension that registers chat models via
`vscode.lm` (today, mainly GitHub Copilot Chat, exposing GPT/Claude/Gemini
models) is automatically usable by GitLore with zero provider-specific code.
Shelling out to CLIs was considered and rejected — it reintroduces per-vendor
parsing/versioning and a command-injection surface that `vscode.lm` avoids
entirely.

## Goals

- `gitLore.explainCommit` turns a commit's diff into a plain-English summary,
  shown in the existing Commit Details panel.
- Zero new runtime dependencies. Reuse `LruCache`, the `GitLogger` interface,
  and the existing webview/message-passing pattern.
- Respect the AI privacy contract: never call a model unless
  `gitLore.ai.enabled` is `true`.

## Non-goals (this spec)

- Line explanation (`gitLore.explainLine`) — next spec, reuses
  `LanguageModelClient` from this one.
- Model picker UI, retry/backoff, usage telemetry, multi-turn follow-up chat.

## Architecture

### `src/core/ai/prompts.ts` (pure, unit-tested)

```ts
buildCommitSummaryPrompt(commit: CommitDetail, diff: string, maxDiffChars: number): string
```

Truncates `diff` at `maxDiffChars` with a `[...truncated]` marker appended.
No `vscode` import — testable the same way `core/git/parsers.ts` is.

`core/ai/parseResponse.ts` (listed in `CLAUDE.md`'s file layout) is **not**
created in this spec — the commit summary is plain text with nothing to
structurally parse. Add it when a feature actually needs structured output.

### `src/ai/LanguageModelClient.ts` (thin, vscode-facing)

Same role as `GitService`: a thin wrapper with no unit tests of its own
(covered by integration tests), because the only logic worth unit-testing
already lives in the pure `core/ai/prompts.ts`.

```ts
class LanguageModelClient {
  constructor(private readonly logger: GitLogger) {}
  async selectModel(modelFamily: string): Promise<vscode.LanguageModelChat | undefined>
  async *streamText(model, prompt: string, token: vscode.CancellationToken): AsyncIterable<string>
}
```

`selectModel` calls `vscode.lm.selectChatModels({ family: modelFamily })`,
falling back to an unfiltered `vscode.lm.selectChatModels()` if that returns
nothing, and returns the first result or `undefined`. `streamText` calls
`model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token)`
and yields chunks from `response.text`; logs failures via the injected
`GitLogger` (same interface `GitService` already uses — no new logger type).

### `src/commands/aiCommands.ts`

Registers `gitLore.explainCommit`, following the existing one-file-per-command-group convention (mirrors `commitCommands.ts`, `branchCommands.ts`).

## Wiring into Commit Details

`CommitDetailsViewProvider` gains a `LanguageModelClient` dependency (same
constructor-injection style as `git: GitService`) and a
`LruCache<string, string>(50)` keyed `${repoRoot}:${sha}`.

New collapsible **AI Summary** section in the webview (same visual pattern as
the existing changed-file sections), with a **Summarize with AI** button.
Manual trigger only — never fires automatically on commit load, since that
would call the model on every commit browsed in File History.

Flow on click (`explainCommit` message from webview):

1. `gitLore.ai.enabled` is `false` → `vscode.window.showInformationMessage`
   with an **Open Settings** action scoped to `gitLore.ai.enabled`. Return.
2. Cache hit for `${repoRoot}:${sha}` → post the cached text back
   immediately, done.
3. Cancel any previous in-flight request for this view (a
   `CancellationTokenSource` per load, replaced on every new `load()` call
   and disposed when the view disposes) — so switching commits mid-stream
   never leaks a stream into a stale webview.
4. `languageModelClient.selectModel(modelFamily)` resolves `undefined` → post
   an inline hint into the section ("No language model available. Enable a
   language model, e.g. GitHub Copilot Chat, to use this feature."). No
   popup — matches `CLAUDE.md` §13's "inline hint, not a popup" for this
   case specifically.
5. Model found → build the prompt via `buildCommitSummaryPrompt`, stream
   chunks into the section via `postMessage`, cache the full text once the
   stream completes.
6. Any error mid-stream (LM error, consent denied, network) → inline error
   text in the section, full error logged to the `GitLore` output channel,
   no popup. A cancellation (case 3) is swallowed silently — not an error.

## Settings and commands

Names are already specified in `CLAUDE.md` §8; this spec wires them up:

| Key | Type | Default |
|---|---|---|
| `gitLore.ai.enabled` | boolean | `false` |
| `gitLore.ai.modelFamily` | string | `"gpt-4o"` |
| `gitLore.ai.maxDiffChars` | number | `8000` |

Command: `gitLore.explainCommit` — "GitLore: Explain Commit with AI".

`constants.ts` `CONFIG` gains `aiEnabled: 'ai.enabled'`,
`aiModelFamily: 'ai.modelFamily'`, `aiMaxDiffChars: 'ai.maxDiffChars'`.

## Testing

- **Unit** (`test/unit/core/ai/prompts.test.ts`): truncation boundary, empty
  diff, normal diff — golden-file style like the existing parser tests.
- **Integration**: extends `test/integration/commitDetails.test.ts` (or a new
  `aiSummary.test.ts`).
  - `gitLore.ai.enabled = false` → clicking triggers the settings prompt.
  - `gitLore.ai.enabled = true` with no LM installed (the real state of any
    CI host, so this is the deterministic, always-testable path) → the
    inline "no model available" hint appears.
  - Needs one new test-only seam on `CommitDetailsViewProvider`, in the same
    spirit as the existing `getCurrentHtmlForTest()`: a way to trigger the AI
    summary flow and capture the sequence of posted messages, since the
    summary state lives in postMessage traffic, not in the static webview
    HTML.

## Deliberately skipped (YAGNI)

- `core/ai/parseResponse.ts` — no structured parsing needed yet.
- Model picker UI — auto-pick only, per explicit decision.
- Retry/backoff on transient failures — a failed request just shows the
  inline error; the button stays clickable to retry manually.
- Usage telemetry — GitLore has zero telemetry by default, and this doesn't
  change that.
