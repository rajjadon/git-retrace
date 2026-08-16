# Phase 8: Conversational AI over git history + AI sweep

## Context

Phases 1–7 are shipped. The existing AI surface (`src/ai/`,
`src/core/ai/`) is single-shot only: one prompt in, one streamed answer out
(`LanguageModelClient.streamText`, used by `CommitMessageService` and
`LineExplanationService`). There is no multi-turn conversation and no way for
a model to pull its own git facts — every existing AI feature is handed a
pre-built prompt string containing exactly the diff/commit/line it needs.

This phase adds a chat interface: the user asks free-form questions about a
repo's history ("who touched this file last", "why did the auth code get
rewritten", "what changed between these two tags") and the model answers by
calling git-backed tools itself, rather than GitLore guessing what context to
stuff into a prompt. It also adds four smaller AI features that reuse the
same tool-calling infrastructure once it exists.

## Decision: tool-calling against `vscode.lm`, not a chat participant

Confirmed against the installed `@types/vscode ^1.85.0`:
`LanguageModelChatTool`, `LanguageModelToolCallPart`,
`LanguageModelToolResultPart`, and `LanguageModelChatMessage.User`/`Assistant`
overloads that accept tool-result/tool-call parts are all present and stable
on the pinned engine version — no feasibility risk.

Two ways to add a chat surface were considered:

1. **Register a `vscode.chat` participant** (`@gitlore`) — gets native
   history/streaming/markdown for free. Rejected: the Chat view only exists
   if a chat host (GitHub Copilot Chat) is installed. That would silently
   break Ollama/Claude-via-other-extension users, violating `CLAUDE.md` §4's
   "user brings their own model" promise.
2. **Custom GitLore webview**, driving `vscode.lm` directly with a
   hand-rolled tool-call loop. Works with any `vscode.lm` model. Chosen.

Docked view (`registerWebviewViewProvider`), not an editor-tab panel
(`createWebviewPanel`): every existing panel (Commit Details, PR Details,
Commit Graph, Branch Comparison, Visual File History) is docked in the
`gitLore` view container. Only Launchpad uses a full tab, because it's a
workspace-wide board, not bound to what you're currently reading. Chat is
meant to stay open beside code — docked matches both convention and VS
Code's own chat UX.

## Goals

- `gitLore.openChat` opens a docked chat panel. The user asks anything about
  the repo's history; the model answers by calling git tools GitLore
  executes locally against `GitService` — no retrieval index, no
  pre-guessed context.
- Context actions (`gitLore.askAboutFile` / `askAboutCommit` /
  `askAboutLine` / `askAboutPullRequest`) open/focus the same panel and seed
  it with a subject, mirroring how `explainLine` already takes
  `(filePath, sha, lineContent)` args.
- Four sweep features reuse the same infrastructure as thin consumers:
  **Explain this PR**, **Branch Compare AI summary**, **NL changelog**, **AI
  PR review draft**.
- Same privacy contract as every other AI feature: nothing runs unless
  `gitLore.ai.enabled` is `true`. Tool calls only ever run local `git` reads
  via the existing `GitService` — never a network call, never a write.

## Non-goals

- Persisted multi-session chat history. One active conversation per panel;
  "New Chat" clears it. Add persistence later if actually wanted.
- Any retrieval/embedding index over git history — tool-calling against live
  `git` commands replaces that entirely.
- Streaming markdown-diff rendering beyond what `diffRender.ts` already
  provides.
- Host-specific chat tools (GitLab/Bitbucket/Azure). Sweep items use each
  `ForgeClient`'s existing interface as-is — no new forge surface.
- A model picker UI, retry/backoff policy, or usage telemetry — same
  exclusions every prior AI spec has made.

## Architecture

### `src/core/ai/gitTools.ts` (pure, unit-tested)

Tool schemas (plain objects matching `LanguageModelChatTool`'s
`{ name, description, inputSchema }` shape — no `vscode` import required,
these are just JSON) plus a dispatcher:

```ts
export const GIT_TOOL_DEFINITIONS: GitToolDefinition[] = [
  { name: 'get_file_history', description: '...', inputSchema: { filePath, maxCount } },
  { name: 'get_line_history', description: '...', inputSchema: { filePath, line } },
  { name: 'get_commit', description: '...', inputSchema: { filePath, sha } },
  { name: 'get_commit_diff', description: '...', inputSchema: { filePath, sha } },
  { name: 'get_commit_files', description: '...', inputSchema: { filePath, sha } },
  { name: 'get_commits_between', description: '...', inputSchema: { filePath, from, to } },
  { name: 'get_diff_between_refs', description: '...', inputSchema: { filePath, base, compare } },
  { name: 'get_branches', description: '...', inputSchema: { filePath } },
  { name: 'get_graph_commits', description: '...', inputSchema: { filePath, maxCount, ref? } },
];

export async function executeGitTool(
  git: GitService,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown>
```

Each tool is a direct 1:1 wrap of an existing `GitService` method — no new
git logic. `executeGitTool` validates `args` shape, calls the matching
method, and returns a JSON-serializable result; unknown tool name or bad args
throws (caught by `chatFlow`, surfaced as a tool-error event, never crashes
the loop).

Diff-shaped results (`get_commit_diff`, `get_diff_between_refs`) are
truncated via `truncateForModel(text, maxChars)`, extracted out of
`core/ai/prompts.ts` (today's `buildCommitSummaryPrompt` /
`buildLineExplanationPrompt` inline their own truncation — pulled into one
shared function reused by both old prompts and new tool results).

### `src/core/ai/chatFlow.ts` (pure, unit-tested)

Same event-generator shape as the existing `commitSummaryFlow.ts`, extended
for multi-turn tool calls:

```ts
export type ChatEvent =
  | { type: 'disabled' }
  | { type: 'noModel' }
  | { type: 'toolCall'; name: string; args: Record<string, unknown> }
  | { type: 'toolResult'; name: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface ChatModel {
  sendChat(
    messages: ChatMessage[],
    tools: GitToolDefinition[],
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamPart>; // text part | tool-call part
}

export interface ChatFlowParams {
  enabled: boolean;
  selectModel: () => Promise<ChatModel | undefined>;
  messages: ChatMessage[]; // full conversation so far, including the new user turn
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxToolIterations: number;
  signal: AbortSignal;
}

export async function* runChatFlow(params: ChatFlowParams): AsyncGenerator<ChatEvent>
```

Loop: send `messages` + `GIT_TOOL_DEFINITIONS` → if the response stream
yields a tool-call part, `yield { type: 'toolCall', ... }`, run
`executeTool`, append the assistant tool-call turn and a user tool-result
turn to `messages`, `yield { type: 'toolResult', name }`, loop again. If the
response is plain text, stream `chunk` events and finish with `done`. Hits
`maxToolIterations` → stop looping and yield `done` with whatever text the
model has produced (never an infinite loop; never silently drops the
model's answer). `ChatModel` is an abstraction (not the raw
`vscode.LanguageModelChat`), so this generator is unit-testable without a
vscode host, same as `commitSummaryFlow.ts`.

### `src/ai/LanguageModelClient.ts` (extended)

```ts
async streamChat(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  tools: vscode.LanguageModelChatTool[],
  signal: AbortSignal,
): AsyncIterable<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart>
```

Wraps `model.sendRequest(messages, { tools }, ...)`, bridging the abort
signal the same way `streamText` already does. `streamText` is untouched —
existing single-shot callers (`CommitMessageService`,
`LineExplanationService`) don't change.

### `src/ai/ChatService.ts` (vscode-facing orchestration)

Constructor-injects `GitService`, `LanguageModelClient`, `GitLogger` — same
pattern as every other AI service. Holds the single active conversation
(`ChatMessage[]`) and adapts `chatFlow`'s abstract `ChatModel`/`executeTool`
to the real `LanguageModelClient.streamChat` + `executeGitTool(git, ...)`.
`newChat()` resets conversation state.

### `src/views/Chat/` (webview)

Cloned from `CommitDetails`'s pattern: `ChatViewProvider.ts` (CSP + nonce,
`onDidReceiveMessage`/`postMessage`), `render.ts` (pure HTML builder reusing
`escapeHtml.ts` and `icons.ts`), `chat.css`. UI: scrollable message list,
input box, a subject chip when opened via a context action (e.g. "Asking
about: `GitService.ts`"), and a transient "Searching commit history…"
indicator while a `toolCall`/`toolResult` event is in flight — this is the
one piece of UI transparency that doesn't exist in any prior AI feature,
because this is the first feature where the model takes actions instead of
just describing pre-fetched data.

### Commands (`src/commands/chatCommands.ts`, new file)

New file rather than growing `aiCommands.ts` — a distinct feature surface
with five command variants. `openChat` requires no arguments; the four
context variants take the subject's identifying args (matching
`explainLine`'s existing `(filePath, sha, lineContent)` convention) and seed
`ChatService`'s conversation with a first system-style context message
before focusing the panel.

## Sweep features (thin consumers of the same infra)

Each below reuses `ChatService`/`chatFlow`/`gitTools` — no new AI plumbing,
only a prompt/flow function and a UI hook:

- **Explain this PR** — button in `PullRequestDetailsViewProvider`. Feeds
  `ForgeClient.getPullRequestDiff` output through a single-shot flow (no
  tool loop needed — the diff is already fetched).
- **Branch Compare AI summary** — a summary block above
  `BranchComparisonViewProvider`'s file list, fed by
  `getDiffBetweenRefs`/`getFilesBetweenRefs` (already-fetched local data —
  single-shot, no tool loop).
- **NL changelog** — new command, prompts for two refs (reusing the
  existing ref-picker pattern from Branch Comparison), then
  `getCommitsBetween` + `getDiffBetweenRefs` → a prose changelog in a
  simple output panel with a copy button.
- **AI PR review draft** — in `PullRequestDetailsViewProvider`, feeds the PR
  diff + `listConversationThreads` into a draft-comments flow. The model
  only ever produces text; the user still clicks the real
  `addComment`/`submitReview` — no autonomous posting, matching every other
  Launchpad write action's confirm-before-execute pattern.

All four are single-shot (no tool-calling loop) because their context is
already fully fetched before the AI call — the agentic loop is specifically
for the open-ended chat, where the question determines what data is needed.

## Settings and commands

| Key | Type | Default | Description |
|---|---|---|---|
| `gitLore.ai.maxToolIterations` | number | `6` | Max tool-call round trips per chat turn before GitLore stops looping and returns whatever answer the model has |

Reuses `gitLore.ai.enabled`, `gitLore.ai.modelFamily`, `gitLore.ai.maxDiffChars`
as-is — no duplicate gating setting.

Commands: `gitLore.openChat`, `gitLore.askAboutFile`, `gitLore.askAboutCommit`,
`gitLore.askAboutLine`, `gitLore.askAboutPullRequest`,
`gitLore.explainPullRequest`, `gitLore.summarizeBranchComparison`,
`gitLore.generateChangelog`, `gitLore.draftPrReview`.

`constants.ts`: `CONFIG.aiMaxToolIterations`, `VIEWS.chat`, and the nine
command IDs above.

## Error handling (per `CLAUDE.md` §13)

- `gitLore.ai.enabled = false` → inline settings prompt in the chat panel
  (matches the existing "Open Settings" pattern), not a popup.
- No model available → inline hint, same wording convention as
  `LineExplanationService`.
- Tool execution throws (e.g. bad ref, detached HEAD, no repo) → caught in
  `chatFlow`, surfaced as a `toolResult` event carrying an error string fed
  back to the model as the tool result — the model can tell the user "that
  ref doesn't exist" instead of the extension crashing.
- `maxToolIterations` reached → the loop stops cleanly; whatever text the
  model has produced is shown, no error.
- Every git tool call goes through the existing `GitService`, so existing
  guarantees (no repo, untracked file, huge files) already hold.

## Testing

- **Unit** (`test/unit/core/ai/`): `gitTools.test.ts` (schema shape,
  `executeGitTool` dispatch + arg validation + truncation of diff-shaped
  results), `chatFlow.test.ts` (tool-call loop against a fake `ChatModel` —
  no-tool-call path, single tool call, multiple iterations,
  `maxToolIterations` cutoff, disabled/no-model/error paths — same style as
  existing `commitSummaryFlow` tests).
- **Integration** (`test/integration/`): new `chat.test.ts` — panel opens,
  `gitLore.ai.enabled = false` shows the inline prompt, no-LM-available path
  (deterministic on any CI host), a context action seeds the subject chip.
  Needs the same test-only message-capture seam other providers already
  have (`getCurrentHtmlForTest()`-equivalent).
- Sweep features each get one integration test confirming their button
  triggers the flow and the disabled/no-model paths behave the same as
  every other AI feature (no new edge cases to invent — same gating as
  above).

## Deliberately skipped (YAGNI)

- Persisted chat history/sessions.
- A retrieval/embedding index — tool-calling replaces it.
- Streaming partial tool-call argument display — only start/finish is shown.
- Any new forge-specific tool beyond what `ForgeClient` already exposes.
- A shared "AI action" abstraction wrapping all nine new commands — each
  stays a direct, thin command handler; introduce a shared helper only if
  real duplication shows up once they're written, not speculatively now.
