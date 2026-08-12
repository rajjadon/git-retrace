# Hover-native line explanation (replaces panel-based `explainLine`)

## Context

The just-shipped `gitLore.explainLine` opens Commit Details in the bottom
panel and auto-streams a line-focused explanation there. Live manual testing
surfaced real dissatisfaction: clicking the hover's "Explain this line with
AI" link navigates focus away to the bottom panel, which breaks the
in-context reading flow the hover was supposed to preserve.

Research into VS Code's extension API confirms two hard platform
constraints, not gaps in our code:

- **A `Hover` is a one-shot, static return value.** There is no API to push
  updates into an already-open hover
  ([confirmed unsupported](https://github.com/microsoft/vscode/issues/137714),
  [discussed here](https://github.com/microsoft/vscode-discussions/discussions/2574)).
  Live streaming into an open hover is not achievable with any stable API.
- **There is no public "custom peek widget" API.** Extensions cannot create
  a Peek-Definition-style widget with arbitrary content
  ([open feature request, unresolved](https://github.com/microsoft/vscode/issues/100904)).

Given these constraints, this spec replaces the panel-based flow with:
click the hover's link → generation runs headlessly in the background (a
status-bar progress indicator, no panel) → **re-hovering the same line**
shows the finished explanation directly in that hover card, from a small
dedicated cache. No live streaming, but the explanation never leaves the
hover paradigm.

## Decisions from brainstorming

- **Fully replaces** the panel-based line-explanation path, not a second
  entry point alongside it. The panel's `lineExplanation`-mode code from the
  prior plan is removed as dead code, not left dormant.
- **Progress feedback** is `vscode.window.withProgress` at
  `ProgressLocation.Window` (a small status-bar spinner, matching VS Code's
  own background-task conventions) — no notification popups, no panel.

## Goals

- Clicking "Explain this line with AI" never navigates focus away from the
  editor.
- Re-hovering the same line after generation completes shows the
  explanation directly in the hover card.
- Reuse `runCommitSummaryFlow`, `LanguageModelClient`, and
  `buildLineExplanationPrompt` unchanged — this is a new trigger/display
  path around existing, already-tested orchestration logic, not a new AI
  stack.

## Non-goals

- Live streaming into the hover (platform-impossible, see Context).
- A "regenerate" affordance for an already-`done` explanation — re-clicking
  the link is unavailable once `done` (no link is rendered), and the answer
  is deterministic-enough per commit+line that this isn't worth the added
  surface. Revisit if requested.
- Any change to the whole-commit `gitLore.explainCommit` panel flow — it
  is untouched by this spec.

## Architecture

### New: `LineExplanationState` and its store

Defined in `src/ai/LineExplanationService.ts` (see below):

```ts
export type LineExplanationState =
  | { status: 'pending' }
  | { status: 'done'; text: string }
  | { status: 'noModel' }
  | { status: 'error'; message: string };
```

Stored in `LruCache<string, LineExplanationState>` (the existing generic
`LruCache`, no new cache class), keyed `` `${repoRoot ?? filePath}:${sha}:${lineContent}` ``
— the same key shape the panel's (now-removed) line-explanation cache used,
minus the now-unneeded `:line:` infix since this store holds nothing else.
Instantiated once in `extension.ts`, injected into both
`LineExplanationService` (the writer) and `BlameHoverProvider` (the reader).
This shared store is the only new piece of cross-cutting state — it's what
connects a hover-link click to the next hover render.

### New: `LineExplanationService`

Constructor-injected `(git: GitService, languageModelClient:
LanguageModelClient, logger: GitLogger, store: LruCache<string,
LineExplanationState>)` — same DI pattern as `CommitDetailsViewProvider`.
One public method:

```ts
async explain(filePath: string, sha: string, lineContent: string, signal: AbortSignal): Promise<void>
```

Owns the entire flow, mirroring `CommitDetailsViewProvider.runAiFlow` but
headless (no webview, no postMessage):

1. Build the key and read the existing state **once**, before writing
   anything:
   - If `existing?.status === 'pending'`, return immediately (defensive
     guard — in practice the hover doesn't render a link while pending, so
     this path is rarely hit, but it's cheap insurance against a stray
     re-invocation).
   - Otherwise, capture `cached = existing?.status === 'done' ? existing.text
     : undefined` — this is what makes step 5 below reuse a prior answer
     instead of re-calling the model. Capturing it now, before the store is
     overwritten in the next step, is what makes that reuse actually work;
     reading it any later would only ever see the `pending` state this
     method is about to set.
2. Set `{ status: 'pending' }`.
3. Read config (`ai.enabled`, `ai.modelFamily`, `ai.maxDiffChars` — same
   keys the panel flow already uses, no new settings).
4. Fetch `commit`/`diff` via `git.getCommit`/`git.getCommitDiff` (the
   headless flow has no panel state to reuse, unlike the panel's
   `runAiFlow`, so it fetches these itself).
5. Pass the `cached` value captured in step 1 into `runCommitSummaryFlow` —
   this reuses the flow's existing `'cached'` short-circuit for free, so a
   duplicate `explain()` call for an already-answered line resolves
   instantly instead of re-calling the model.
6. Run `runCommitSummaryFlow({ enabled, cached, signal, selectModel,
   buildPrompt: () => buildLineExplanationPrompt(commit, diff, lineContent,
   maxDiffChars) })` and iterate it:
   - `'disabled'` → `vscode.window.showInformationMessage('GitLore: AI
     features are disabled.', 'Open Settings')` (identical UX to the
     panel's existing disabled-prompt), then **delete** the key from the
     store (so the hover reverts to showing the link, not stuck on
     `pending`).
   - `'cached'` → no-op (the store already holds the right `done` state).
   - `'chunk'` → discarded (no live surface to update).
   - `'done'` → `store.set(key, { status: 'done', text: event.text })`.
   - `'noModel'` → `store.set(key, { status: 'noModel' })`.
   - `'error'` → `logger.error(...)` (same as the panel flow), then
     `store.set(key, { status: 'error', message: event.message })`.
7. On abort (the progress notification's cancel button, wired below):
   `store.delete(key)` — reverts to "never asked," letting the user retry
   via the link again, consistent with how the panel flow already treats
   cancellation as silent, not an error.

### Command handler — thin wrapper

`src/commands/aiCommands.ts`'s `handleExplainLineCommand` becomes:

```ts
export function handleExplainLineCommand(service: LineExplanationService): vscode.Disposable {
  return vscode.commands.registerCommand(
    COMMANDS.explainLine,
    async (filePath?: string, sha?: string, lineContent?: string) => {
      if (typeof filePath !== 'string' || typeof sha !== 'string' || typeof lineContent !== 'string') {
        void vscode.window.showInformationMessage('GitLore: pick a line with committed history to explain.');
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'GitLore: explaining line…', cancellable: true },
        async (_progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());
          await service.explain(filePath, sha, lineContent, controller.signal);
        },
      );
    },
  );
}
```

No longer takes a `CommitDetailsViewProvider` — takes the new
`LineExplanationService` instead. `extension.ts` updates the construction
and wiring accordingly.

### Hover rendering

`formatBlameHover` (`src/utils/format.ts`) gains one new parameter, the
looked-up state for this exact line:

```ts
export function formatBlameHover(
  entry: BlameLine,
  diffStat: FileChange | null,
  filePath: string,
  lineContent: string,
  lineExplanation: LineExplanationState | undefined,
  now: Date = new Date(),
  issueLinking: IssueLinkOptions | null = null,
): string
```

Replaces the unconditional "Explain this line with AI" link with a branch:

- `undefined` (never asked) → today's link, unchanged.
- `{ status: 'pending' }` → a plain, non-clickable line: `"⏳ Generating
  explanation…"`. No link — there's nothing useful a re-click would do
  while already in flight.
- `{ status: 'done', text }` → the explanation rendered directly in the
  card: a bolded label ("Why this line exists:") followed by `text`
  (markdown-escaped the same way commit messages already are — see Error
  Handling below). No link.
- `{ status: 'noModel' }` → the same "No language model available…"
  message the panel already uses, **plus the link again**, so the user can
  retry after installing a model.
- `{ status: 'error', message }` → `"Failed to generate explanation: ⟨message⟩"`,
  **plus the link again** to retry.

`BlameHoverProvider.provideHover` resolves `repoRoot` via
`this.git.getRepoRoot(doc.uri.fsPath)` (a call it doesn't currently make —
new, but the same kind of async git call `getFileDiffStat` already makes on
every hover, so no new performance category), builds the same key shape the
service uses, looks it up in the shared store, and passes the result into
`formatBlameHover`.

## Error handling and security

- The `'disabled'` gate, the `GitLogger`-based error logging, and the
  `isTrusted: { enabledCommands: [COMMANDS.explainLine] }` scoping on the
  hover's `MarkdownString` are all unchanged from the shipped feature.
- `text` from a `'done'` state is model-generated content rendered into a
  `MarkdownString` — pass it through the same `escapeMarkdown` helper
  `format.ts` already uses for commit messages, so the model can't inject
  a fake command link or emphasis into its own hover card.

## Removed (dead code from the prior plan)

- `CommitDetailsViewProvider.explainLine()`.
- `show()`'s `lineContent` parameter and `load()`'s auto-run branch —
  `show()` reverts to its original two-parameter signature.
- `currentLineContent` field and `handleMessage`'s mode-routing for the
  `explainCommit` message (reverts to always calling `explainCommit()`).
- `render.ts`'s `lineExplanation` option and the AI section's
  conditional heading/button/disabled-state — reverts to always
  rendering "AI Summary" / "Summarize with AI", enabled.
- Every unit/integration test written against the above in the prior plan.

`buildLineExplanationPrompt`, `runCommitSummaryFlow`, the hover's
command-link encoding, and `isTrusted` scoping are all kept and reused
as-is.

## Testing

- **Unit:** `LineExplanationState`-branch tests for `formatBlameHover`
  (link/pending/done/noModel/error render correctly, `done` text is
  markdown-escaped). No new tests needed for `runCommitSummaryFlow` or
  `buildLineExplanationPrompt` — unchanged.
- **Integration:** `gitLore.explainLine` with `ai.enabled=false` still
  shows the settings prompt and the store stays empty for that key; with
  `ai.enabled=true` and no model registered (the deterministic CI-host
  case), the store ends up `{ status: 'noModel' }` for the key, and a
  subsequent hover at that position renders the "no model" message.
  `LineExplanationService` gains a test-only method,
  `getStateForTest(filePath: string, sha: string, lineContent: string):
  LineExplanationState | undefined`, wired into `GitLoreTestApi` as
  `getLineExplanationStateForTest`, mirroring the existing
  `getAiSummaryMessagesForTest()` pattern exactly.
- Remove the tests tied to the deleted panel-based line-explanation code
  (see Removed, above) as part of the same tasks that delete that code.

## Deliberately skipped (YAGNI)

- Regenerate affordance for a `done` explanation.
- Cross-line concurrency limits beyond the single-key pending-guard — a
  user explaining five different lines in a row gets five independent
  background generations; `withProgress` handles multiple simultaneous
  window-level progress items natively.
- Persisting the store across VS Code restarts — in-memory only, same as
  every other AI cache in this codebase.
