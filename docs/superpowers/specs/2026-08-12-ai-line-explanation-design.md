# Phase 2, sub-project 2: AI line explanation

## Context

Sub-project 1 shipped `gitLore.explainCommit` (merged to `master` via PR from
`Phase-2`): a `LanguageModelClient` adapter over `vscode.lm`, a pure
`runCommitSummaryFlow` state machine, and a "Summarize with AI" section in
the Commit Details panel. This spec adds `gitLore.explainLine` — "GitLore:
Explain This Line's History" (reserved in `constants.ts`, listed in
`CLAUDE.md` §7/§8) — reusing that infrastructure rather than building a
parallel stack.

## Decisions carried over from brainstorming

- **Scope is the blamed commit only**, not the line's full multi-commit
  lineage (`git log -L`). This keeps the feature a variant of commit
  summary — same data shape, different prompt and trigger — instead of a
  new git-history subsystem.
- **Display surface is the existing Commit Details panel**, not a new
  hover-anchored widget. VS Code hovers vanish on mouse-out, which is fatal
  for a multi-second AI stream; the panel already solves this for commit
  summaries.
- **One adaptive AI section**, not two. The panel's existing section
  changes its label/prompt/trigger-mode based on how it was opened, rather
  than showing a second AI section alongside the first.

## Goals

- A command link in the blame hover ("Explain this line with AI") opens
  Commit Details for the line's blamed commit and automatically streams an
  explanation focused on that specific line — no second click needed.
- Reuse `runCommitSummaryFlow`, `LanguageModelClient`, the `gitLore.ai.*`
  settings, and the whole error-handling taxonomy unchanged.

## Non-goals

- Multi-commit line history / `git log -L` walking.
- Any new `gitLore.ai.*` setting — this feature reads the existing
  `ai.enabled` / `ai.modelFamily` / `ai.maxDiffChars` keys.
- Auto-scrolling or expanding the relevant diff hunk when the panel opens.

## Architecture

### `src/core/ai/prompts.ts` (pure, unit-tested)

Add a sibling to the existing `buildCommitSummaryPrompt`:

```ts
buildLineExplanationPrompt(commit: CommitDetail, diff: string, lineContent: string, maxDiffChars: number): string
```

Truncates `diff` exactly like `buildCommitSummaryPrompt` does. The prompt
asks the model to explain why the given line (passed as literal text, not a
line number) exists, using the commit's diff as context.

**Why literal text, not a line number:** `BlameLine.line` is the line's
index in the *current* file. If anything else in the file has shifted since
the blamed commit, that index won't line up with the diff's own line
numbers. Passing the line's current text lets the model locate it inside
the diff directly — no numbering correlation, no extra git call to resolve
"what was this line's number at commit time."

### `runCommitSummaryFlow` — unchanged

Already generic over `buildPrompt: () => string`. Sub-project 2 needs zero
changes to this file — it's called with a different prompt builder and a
different cache-key suffix, nothing else differs.

### `CommitDetailsViewProvider`

Factor the existing `explainCommit()` body into a shared private method:

```ts
private async runAiFlow(promptBuilder: (commit: CommitDetail, diff: string) => string, cacheKeySuffix: string): Promise<void>
```

`explainCommit()` becomes a one-line call with `buildCommitSummaryPrompt`
and suffix `''`. New `explainLine(lineContent: string): Promise<void>` calls
it with `buildLineExplanationPrompt` (partially applied with `lineContent`)
and suffix `` `:line:${lineContent}` ``. Cache key becomes:

```
`${repoRoot ?? filePath}:${commit.sha}${cacheKeySuffix}`
```

So a plain commit summary and a line explanation for the same commit get
separate cache entries, and two different lines explained in the same
commit don't collide with each other.

`show()` gains an optional parameter:

```ts
async show(filePath: string, sha: string, lineContent?: string): Promise<void>
```

When `lineContent` is present, after `load()` finishes, the provider calls
`this.explainLine(lineContent)` itself — no click, no fake DOM event. The
hover-link click that invoked `gitLore.explainLine` in the first place is
already the explicit user action the platform's "only in response to a
user action" rule requires; a second manual click in the panel would be
redundant. Opened the normal way (no `lineContent`), behavior is byte-for-
byte what sub-project 1 shipped.

### `src/commands/aiCommands.ts`

Add `handleExplainLineCommand(provider)`, registering `gitLore.explainLine`
with signature `(filePath: string, sha: string, lineContent: string)`,
calling `provider.show(filePath, sha, lineContent)`.

### Hover — `src/utils/format.ts` + `src/providers/BlameHoverProvider.ts`

`formatBlameHover` gains the file path and the line's current text as
parameters, and appends a command link when the entry isn't uncommitted:

```
[Explain this line with AI](command:gitLore.explainLine?<encoded [filePath, sha, lineContent]>)
```

`BlameHoverProvider.provideHover` passes `doc.uri.fsPath` and
`doc.lineAt(pos.line).text`, and sets:

```ts
markdown.isTrusted = { enabledCommands: [COMMANDS.explainLine] };
```

Scoped trust for exactly this one command — not blanket `isTrusted: true`.
Blame text is already markdown-escaped (`escapeMarkdown`) before this
change, so there's no existing path for arbitrary content to become a
command link; this is defense in depth, not a fix for a live hole.

The link is shown regardless of `gitLore.ai.enabled` — same precedent as
the "Summarize with AI" button always being visible; clicking while
disabled surfaces the existing "Open Settings" prompt.

### `render.ts`

`renderCommitDetailsHtml`'s options gain an optional `lineExplanation:
boolean`. When true: the AI section's heading reads "Why does this line
exist?", the button reads "Explain this line" instead of "Summarize with
AI", and the button's initial HTML includes the `disabled` attribute (a
flow is already running by the time the webview renders, so the button
must not invite a second, duplicate trigger). No inline-script changes are
needed beyond that: the existing `aiSummaryChunk`/`aiSummaryDone`/
`aiSummaryNoModel`/`aiSummaryError` handlers already flip `disabled` back
to `false` on completion, and they fire identically regardless of whether
the flow was started by a click or by the provider auto-running it.

## Error handling, settings, testing conventions

All inherited unchanged from sub-project 1: `gitLore.ai.enabled` gate,
`GitLogger`-based logging, inline "no model" hint, the same six
`aiSummary*` postMessage types, the same test-only message-capture seam.

## Testing

- **Unit:** `buildLineExplanationPrompt` — same shape of tests as
  `buildCommitSummaryPrompt` (truncation boundary, empty diff, line content
  appears in the output). `formatBlameHover` golden tests — link present
  for a committed line, absent for an uncommitted one, correctly
  URI-encoded arguments.
- **Integration:** extend `commitDetails.test.ts` — `show(filePath, sha,
  lineContent)` with `ai.enabled=false` triggers the same settings prompt;
  with `ai.enabled=true` and no model registered, the no-model hint appears
  automatically without any additional command being invoked (proving the
  auto-run path, the one behavior genuinely new here). A hover test
  confirming the command link's presence/absence and its `isTrusted`
  scoping.

## Deliberately skipped (YAGNI)

- Multi-commit line history.
- A distinct settings namespace for line explanation vs. commit summary.
- Auto-scroll/expand to the relevant diff hunk.
- A visual distinction in the diff view highlighting which line prompted
  the explanation — the line's literal text is already the strongest
  signal the model has; a UI highlight would be for the human, and the
  existing file filter already gets them to the right file quickly.
