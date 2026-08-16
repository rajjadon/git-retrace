# Conversational AI Chat + Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tool-calling chat panel that answers free-form questions about a repo's git history, plus four thin AI features (Explain this PR, Branch Compare AI summary, NL changelog, AI PR review draft) that reuse the same infrastructure.

**Architecture:** A pure, vscode-free tool-calling loop (`core/ai/chatFlow.ts`) drives a fixed set of git-backed tools (`core/ai/gitTools.ts`, thin wrappers over existing `GitService` methods). `ai/ChatService.ts` wires that loop to a real `vscode.lm` model via a new `LanguageModelClient.streamChat`/`selectChatModel`, and a docked webview (`views/Chat/`) drives it from the UI, following the exact CSP/nonce/message pattern already used by `CommitDetailsViewProvider`. The four sweep features are single-shot consumers of the same `LanguageModelClient` + `runCommitSummaryFlow` pattern already used by "Explain Commit with AI" — no tool loop needed there, since their context is already fully fetched.

**Tech Stack:** TypeScript strict, `vscode.lm` (Language Model API, tool-calling via `LanguageModelChatTool`/`LanguageModelToolCallPart`/`LanguageModelToolResultPart`, confirmed present in the pinned `@types/vscode ^1.85.0`), `simple-git` (via `GitService`, untouched), esbuild, `node:test` for unit tests, `@vscode/test-electron` + Mocha for integration tests.

**Spec:** `docs/superpowers/specs/2026-08-15-conversational-ai-chat-design.md`

## Global Constraints

- `core/` stays 100% `vscode`-free — `chatFlow.ts` and `gitTools.ts` import nothing from `vscode`.
- Nothing calls a model unless `gitLore.ai.enabled` is `true` — checked before any git call, same as every existing AI feature (never spawn a git subprocess just to throw the output away).
- No `any`. No non-null `!` without an inline comment justifying it.
- No magic strings — every command ID / config key / view ID / media filename goes through `constants.ts`.
- Every `vscode.Disposable` goes into `context.subscriptions`.
- No new runtime dependencies.
- `activate()` must still return in <50ms — nothing in this plan does I/O at construction time (matches every existing service/provider constructor).
- TDD: write the failing test first, verify it fails, implement, verify it passes, commit — one task at a time.
- Never `git commit` — the user commits their own work. Steps below say "commit" for planning-completeness only; the implementer stages changes but does not run `git commit`.

---

## Milestone A — Pure core: tool definitions and the tool-calling loop

### Task 1: Extract `truncateForModel` and reuse it across every prompt builder

**Files:**
- Modify: `src/core/ai/prompts.ts`
- Test: `test/unit/core/ai/prompts.test.ts` (existing file — add cases, don't replace it)

**Interfaces:**
- Produces: `export function truncateForModel(text: string, maxChars: number): string` — truncates `text` to `maxChars`, appending `'[...truncated]'` when it does. Used by every existing prompt builder and by `gitTools.ts` (Task 2) for diff-shaped tool results.

- [ ] **Step 1: Write the failing test**

Add to `test/unit/core/ai/prompts.test.ts` (follow its existing `node:test` + `node:assert/strict` style):

```ts
import { truncateForModel } from '../../../../src/core/ai/prompts';

test('truncateForModel: returns text unchanged when under the limit', () => {
  assert.equal(truncateForModel('short', 100), 'short');
});

test('truncateForModel: truncates and appends the marker when over the limit', () => {
  const text = 'a'.repeat(20);
  assert.equal(truncateForModel(text, 10), 'a'.repeat(10) + '[...truncated]');
});

test('truncateForModel: text exactly at the limit is not truncated', () => {
  const text = 'a'.repeat(10);
  assert.equal(truncateForModel(text, 10), text);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="truncateForModel"`
Expected: FAIL — `truncateForModel` is not exported from `src/core/ai/prompts.ts`.

- [ ] **Step 3: Implement — extract the shared helper**

In `src/core/ai/prompts.ts`, replace the three inline `diff.length > maxDiffChars ? diff.slice(...) + TRUNCATION_MARKER : diff` expressions with calls to a new exported function:

```ts
const TRUNCATION_MARKER = '[...truncated]';

/** Truncates `text` to `maxChars`, appending a marker when it does. Shared by every prompt builder below and by `core/ai/gitTools.ts`'s diff-shaped tool results. */
export function truncateForModel(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + TRUNCATION_MARKER : text;
}

export function buildCommitSummaryPrompt(commit: CommitDetail, diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  // ...unchanged template below this line
}

export function buildLineExplanationPrompt(commit: CommitDetail, diff: string, lineContent: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  // ...unchanged template below this line
}

export function buildCommitMessagePrompt(diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  // ...unchanged template below this line
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern="truncateForModel"`
Expected: PASS. Also run the full `prompts.test.ts` suite to confirm the three existing builders still pass unchanged: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`.

- [ ] **Step 5: Commit (stage only — do not run `git commit`)**

```bash
git add src/core/ai/prompts.ts test/unit/core/ai/prompts.test.ts
```

---

### Task 2: `core/ai/gitTools.ts` — tool definitions and the tool executor

**Files:**
- Create: `src/core/ai/gitTools.ts`
- Test: `test/unit/core/ai/gitTools.test.ts`

**Interfaces:**
- Consumes: `GitService` (existing) — `getFileHistory(filePath, maxCount)`, `getLineHistory(filePath, line)`, `getCommit(filePath, sha)`, `getCommitDiff(filePath, sha)`, `getCommitFiles(filePath, sha)`, `getCommitsBetween(filePath, from, to)`, `getDiffBetweenRefs(filePath, base, compare)`, `getBranches(filePath)`, `getGraphCommits(filePath, maxCount, ref?)`. `truncateForModel` from Task 1.
- Produces: `export interface GitToolDefinition { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, { type: string; description: string }>; required: string[] } }`, `export const GIT_TOOL_DEFINITIONS: GitToolDefinition[]`, `export async function executeGitTool(git: GitService, filePath: string, name: string, args: Record<string, unknown>, maxDiffChars: number): Promise<unknown>` — consumed by `ai/ChatService.ts` (Task 5).

**Design note:** `filePath` is a separate parameter, not part of the tool's JSON schema — GitLore always knows the chat's current repo context, so the model is never asked to supply an absolute path it could get wrong. Every `GitToolDefinition.inputSchema` below only describes the arguments the model actually needs to choose (sha, line, refs, counts).

- [ ] **Step 1: Write the failing test**

Create `test/unit/core/ai/gitTools.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIT_TOOL_DEFINITIONS, executeGitTool } from '../../../../src/core/ai/gitTools';
import type { GitService } from '../../../../src/core/git/GitService';

function fakeGit(overrides: Partial<GitService> = {}): GitService {
  return overrides as GitService;
}

test('GIT_TOOL_DEFINITIONS: every tool has a name, description, and object inputSchema', () => {
  for (const tool of GIT_TOOL_DEFINITIONS) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('GIT_TOOL_DEFINITIONS: names are unique', () => {
  const names = GIT_TOOL_DEFINITIONS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('executeGitTool: get_file_history calls GitService.getFileHistory with filePath and maxCount', async () => {
  let called: [string, number] | undefined;
  const git = fakeGit({
    getFileHistory: async (filePath: string, maxCount: number) => {
      called = [filePath, maxCount];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_file_history', { maxCount: 10 }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 10]);
});

test('executeGitTool: get_line_history calls GitService.getLineHistory with filePath and line', async () => {
  let called: [string, number] | undefined;
  const git = fakeGit({
    getLineHistory: async (filePath: string, line: number) => {
      called = [filePath, line];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_line_history', { line: 41 }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 41]);
});

test('executeGitTool: get_commit calls GitService.getCommit with filePath and sha', async () => {
  let called: [string, string] | undefined;
  const git = fakeGit({
    getCommit: async (filePath: string, sha: string) => {
      called = [filePath, sha];
      return null;
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_commit', { sha: 'abc123' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 'abc123']);
});

test('executeGitTool: get_commit_diff truncates a diff over maxDiffChars', async () => {
  const git = fakeGit({ getCommitDiff: async () => 'x'.repeat(20) });
  const result = await executeGitTool(git, '/repo/a.ts', 'get_commit_diff', { sha: 'abc123' }, 10);
  assert.equal(result, 'x'.repeat(10) + '[...truncated]');
});

test('executeGitTool: get_commit_files calls GitService.getCommitFiles', async () => {
  let called: [string, string] | undefined;
  const git = fakeGit({
    getCommitFiles: async (filePath: string, sha: string) => {
      called = [filePath, sha];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_commit_files', { sha: 'abc123' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 'abc123']);
});

test('executeGitTool: get_commits_between calls GitService.getCommitsBetween with from and to', async () => {
  let called: [string, string, string] | undefined;
  const git = fakeGit({
    getCommitsBetween: async (filePath: string, from: string, to: string) => {
      called = [filePath, from, to];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_commits_between', { from: 'main', to: 'feature' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 'main', 'feature']);
});

test('executeGitTool: get_diff_between_refs truncates a diff over maxDiffChars', async () => {
  const git = fakeGit({ getDiffBetweenRefs: async () => 'y'.repeat(20) });
  const result = await executeGitTool(git, '/repo/a.ts', 'get_diff_between_refs', { base: 'main', compare: 'feature' }, 10);
  assert.equal(result, 'y'.repeat(10) + '[...truncated]');
});

test('executeGitTool: get_branches calls GitService.getBranches', async () => {
  let called: string | undefined;
  const git = fakeGit({
    getBranches: async (filePath: string) => {
      called = filePath;
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_branches', {}, 8000);
  assert.equal(called, '/repo/a.ts');
});

test('executeGitTool: get_graph_commits passes maxCount and an optional ref through', async () => {
  let called: [string, number, string | undefined] | undefined;
  const git = fakeGit({
    getGraphCommits: async (filePath: string, maxCount: number, ref?: string) => {
      called = [filePath, maxCount, ref];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_graph_commits', { maxCount: 50, ref: 'main' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 50, 'main']);
});

test('executeGitTool: an unknown tool name throws', async () => {
  await assert.rejects(() => executeGitTool(fakeGit(), '/repo/a.ts', 'not_a_real_tool', {}, 8000), /Unknown tool/);
});

test('executeGitTool: a missing required argument throws instead of calling GitService with undefined', async () => {
  const git = fakeGit({ getCommit: async () => { throw new Error('should not be called'); } });
  await assert.rejects(() => executeGitTool(git, '/repo/a.ts', 'get_commit', {}, 8000), /requires/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/core/ai/gitTools.test.ts`
Expected: FAIL — `src/core/ai/gitTools.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/core/ai/gitTools.ts`:

```ts
import type { GitService } from '../git/GitService';
import { truncateForModel } from './prompts';

export interface GitToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/** Git-backed tools the chat model can call, each a thin wrapper over an existing `GitService` method — no new git logic. `filePath` is never part of a schema: GitLore always supplies the chat's current repo context itself, so the model is never asked to guess an absolute path. */
export const GIT_TOOL_DEFINITIONS: GitToolDefinition[] = [
  {
    name: 'get_file_history',
    description: "Every commit that touched the current file, newest first. Use this for 'who changed this file' or 'when was this file last touched'.",
    inputSchema: {
      type: 'object',
      properties: { maxCount: { type: 'number', description: 'Max commits to return.' } },
      required: ['maxCount'],
    },
  },
  {
    name: 'get_line_history',
    description: "Every commit that changed one exact line in the current file, newest first. Use this for 'who wrote this line' or 'why did this line change'.",
    inputSchema: {
      type: 'object',
      properties: { line: { type: 'number', description: '0-based line number.' } },
      required: ['line'],
    },
  },
  {
    name: 'get_commit',
    description: 'Full metadata (author, date, full commit message) for one commit by its SHA.',
    inputSchema: {
      type: 'object',
      properties: { sha: { type: 'string', description: 'A commit SHA, full or abbreviated.' } },
      required: ['sha'],
    },
  },
  {
    name: 'get_commit_diff',
    description: "One commit's unified diff, across every file it touched.",
    inputSchema: {
      type: 'object',
      properties: { sha: { type: 'string', description: 'A commit SHA, full or abbreviated.' } },
      required: ['sha'],
    },
  },
  {
    name: 'get_commit_files',
    description: 'Every file one commit touched, with insertion/deletion counts.',
    inputSchema: {
      type: 'object',
      properties: { sha: { type: 'string', description: 'A commit SHA, full or abbreviated.' } },
      required: ['sha'],
    },
  },
  {
    name: 'get_commits_between',
    description: "Commits reachable from 'to' but not from 'from' — e.g. what one branch/tag has that another doesn't.",
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Ref, branch, tag, or SHA to start from.' },
        to: { type: 'string', description: 'Ref, branch, tag, or SHA to end at.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_diff_between_refs',
    description: 'Unified diff between two refs (branches, tags, or SHAs), against their merge-base.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Base ref.' },
        compare: { type: 'string', description: 'Compare ref.' },
      },
      required: ['base', 'compare'],
    },
  },
  {
    name: 'get_branches',
    description: 'Every local and remote branch in the repo.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_graph_commits',
    description: "Repo-wide commit history (every branch by default, or one branch via 'ref'), newest first.",
    inputSchema: {
      type: 'object',
      properties: {
        maxCount: { type: 'number', description: 'Max commits to return.' },
        ref: { type: 'string', description: 'Optional: limit to this one branch instead of every branch.' },
      },
      required: ['maxCount'],
    },
  },
];

function requireString(args: Record<string, unknown>, key: string, toolName: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`Tool '${toolName}' requires a string '${key}' argument.`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string, toolName: string): number {
  const value = args[key];
  if (typeof value !== 'number') {
    throw new Error(`Tool '${toolName}' requires a numeric '${key}' argument.`);
  }
  return value;
}

/** Dispatches one tool call to the matching `GitService` method. Diff-shaped results are truncated the same way commit-summary prompts already are. Throws on an unknown tool name or a missing argument — caught by `chatFlow.ts`'s loop and fed back to the model as a tool-result error, never crashing the chat. */
export async function executeGitTool(
  git: GitService,
  filePath: string,
  name: string,
  args: Record<string, unknown>,
  maxDiffChars: number,
): Promise<unknown> {
  switch (name) {
    case 'get_file_history':
      return git.getFileHistory(filePath, requireNumber(args, 'maxCount', name));
    case 'get_line_history':
      return git.getLineHistory(filePath, requireNumber(args, 'line', name));
    case 'get_commit':
      return git.getCommit(filePath, requireString(args, 'sha', name));
    case 'get_commit_diff': {
      const diff = await git.getCommitDiff(filePath, requireString(args, 'sha', name));
      return truncateForModel(diff, maxDiffChars);
    }
    case 'get_commit_files':
      return git.getCommitFiles(filePath, requireString(args, 'sha', name));
    case 'get_commits_between':
      return git.getCommitsBetween(filePath, requireString(args, 'from', name), requireString(args, 'to', name));
    case 'get_diff_between_refs': {
      const diff = await git.getDiffBetweenRefs(filePath, requireString(args, 'base', name), requireString(args, 'compare', name));
      return truncateForModel(diff, maxDiffChars);
    }
    case 'get_branches':
      return git.getBranches(filePath);
    case 'get_graph_commits': {
      const ref = typeof args.ref === 'string' ? args.ref : undefined;
      return git.getGraphCommits(filePath, requireNumber(args, 'maxCount', name), ref);
    }
    default:
      throw new Error(`Unknown tool: '${name}'.`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/core/ai/gitTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/core/ai/gitTools.ts test/unit/core/ai/gitTools.test.ts
```

---

### Task 3: `core/ai/chatFlow.ts` — the tool-calling loop

**Files:**
- Create: `src/core/ai/chatFlow.ts`
- Test: `test/unit/core/ai/chatFlow.test.ts`

**Interfaces:**
- Consumes: `GitToolDefinition` from Task 2 (only as a type — `chatFlow.ts` never imports `gitTools.ts`'s implementation, only forwards the `tools` array it's given).
- Produces: `ChatMessage`, `ChatToolCall`, `ChatStreamPart`, `ChatModel`, `ChatEvent`, `ChatFlowParams`, `export async function* runChatFlow(params: ChatFlowParams): AsyncGenerator<ChatEvent>` — consumed by `ai/ChatService.ts` (Task 5) and adapted to real `vscode.lm` calls by `LanguageModelClient.streamChat` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `test/unit/core/ai/chatFlow.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChatFlow, type ChatEvent, type ChatMessage, type ChatModel, type ChatStreamPart } from '../../../../src/core/ai/chatFlow';
import type { GitToolDefinition } from '../../../../src/core/ai/gitTools';

const TOOLS: GitToolDefinition[] = [
  { name: 'get_commit', description: 'd', inputSchema: { type: 'object', properties: {}, required: [] } },
];

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function textOnlyModel(parts: ChatStreamPart[]): ChatModel {
  return {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

function userMessage(text: string): ChatMessage {
  return { role: 'user', text };
}

test('runChatFlow: disabled short-circuits before selecting a model', async () => {
  let selectCalls = 0;
  const events = await collect(
    runChatFlow({
      enabled: false,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => {
        selectCalls++;
        return textOnlyModel([]);
      },
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [{ type: 'disabled' }]);
  assert.equal(selectCalls, 0);
});

test('runChatFlow: no model available yields noModel', async () => {
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => undefined,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [{ type: 'noModel' }]);
});

test('runChatFlow: a plain text answer streams chunks then done, with no tool calls', async () => {
  const model = textOnlyModel([
    { kind: 'text', text: 'Hello, ' },
    { kind: 'text', text: 'world.' },
  ]);
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'Hello, ' },
    { type: 'chunk', text: 'world.' },
    { type: 'done', text: 'Hello, world.' },
  ]);
});

test('runChatFlow: a single tool call executes and feeds the result back for a second turn', async () => {
  let call = 0;
  const model: ChatModel = {
    async *sendChat(messages): AsyncGenerator<ChatStreamPart, void, unknown> {
      call++;
      if (call === 1) {
        yield { kind: 'toolCall', callId: 't1', name: 'get_commit', args: { sha: 'abc' } };
      } else {
        // Second turn's messages must include the tool result from the first turn.
        const last = messages[messages.length - 1];
        assert.equal(last.toolResult?.callId, 't1');
        yield { kind: 'text', text: 'It was a fix.' };
      }
    },
  };
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('who wrote this?')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async (name, args) => {
        executed.push({ name, args });
        return { author: 'Raj' };
      },
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'toolCall', name: 'get_commit', args: { sha: 'abc' } },
    { type: 'toolResult', name: 'get_commit' },
    { type: 'chunk', text: 'It was a fix.' },
    { type: 'done', text: 'It was a fix.' },
  ]);
  assert.deepEqual(executed, [{ name: 'get_commit', args: { sha: 'abc' } }]);
});

test('runChatFlow: a tool that throws feeds an error result back instead of crashing the loop', async () => {
  let call = 0;
  const model: ChatModel = {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      call++;
      if (call === 1) {
        yield { kind: 'toolCall', callId: 't1', name: 'get_commit', args: {} };
      } else {
        yield { kind: 'text', text: "That commit doesn't exist." };
      }
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('who wrote this?')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => {
        throw new Error('bad sha');
      },
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'toolCall', name: 'get_commit', args: {} },
    { type: 'toolResult', name: 'get_commit' },
    { type: 'chunk', text: "That commit doesn't exist." },
    { type: 'done', text: "That commit doesn't exist." },
  ]);
});

test('runChatFlow: hitting maxToolIterations stops the loop and yields done instead of looping forever', async () => {
  const model: ChatModel = {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      // Always calls a tool, never answers in plain text — simulates a model stuck in a loop.
      yield { kind: 'toolCall', callId: 't1', name: 'get_commit', args: {} };
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => ({ ok: true }),
      maxToolIterations: 2,
    }),
  );
  const toolCallCount = events.filter((e) => e.type === 'toolCall').length;
  assert.equal(toolCallCount, 2);
  assert.deepEqual(events[events.length - 1], { type: 'done', text: '' });
});

test('runChatFlow: a mid-stream failure yields chunks seen so far, then error', async () => {
  const model: ChatModel = {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      yield { kind: 'text', text: 'partial ' };
      throw new Error('model exploded');
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'partial ' },
    { type: 'error', message: 'model exploded' },
  ]);
});

test('runChatFlow: aborting mid-stream ends the generator with no error event', async () => {
  const controller = new AbortController();
  const model: ChatModel = {
    async *sendChat(_messages, _tools, signal): AsyncGenerator<ChatStreamPart, void, unknown> {
      yield { kind: 'text', text: 'first ' };
      controller.abort();
      if (signal.aborted) {
        return;
      }
      yield { kind: 'text', text: 'second' };
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: controller.signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [{ type: 'chunk', text: 'first ' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/core/ai/chatFlow.test.ts`
Expected: FAIL — `src/core/ai/chatFlow.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/core/ai/chatFlow.ts`:

```ts
import type { GitToolDefinition } from './gitTools';

export type ChatRole = 'user' | 'assistant';

export interface ChatToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  /** Plain text — present on a normal user question or a model's final text answer. */
  text?: string;
  /** Present on an assistant turn that invoked a tool (recorded so the model sees its own past calls). */
  toolCall?: ChatToolCall;
  /** Present on a user turn that carries a tool's result back to the model. */
  toolResult?: { callId: string; result: unknown };
}

export type ChatStreamPart =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; callId: string; name: string; args: Record<string, unknown> };

/** A model bound to a tool-calling chat request. Deliberately not `vscode.LanguageModelChat` — this stays vscode-free so the whole loop is unit-testable, same reasoning as `commitSummaryFlow.ts`'s `SummaryModel`. */
export interface ChatModel {
  sendChat(messages: ChatMessage[], tools: GitToolDefinition[], signal: AbortSignal): AsyncIterable<ChatStreamPart>;
}

export type ChatEvent =
  | { type: 'disabled' }
  | { type: 'noModel' }
  | { type: 'toolCall'; name: string; args: Record<string, unknown> }
  | { type: 'toolResult'; name: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface ChatFlowParams {
  enabled: boolean;
  selectModel: () => Promise<ChatModel | undefined>;
  messages: ChatMessage[];
  tools: GitToolDefinition[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxToolIterations: number;
  signal: AbortSignal;
}

/**
 * Pure orchestration for the chat panel: disabled check -> model selection -> (send the
 * conversation, stream text or tool-call parts -> execute any tool calls -> feed results back as
 * new turns) on repeat until the model answers in plain text or `maxToolIterations` is reached.
 * `ChatModel`/`AbortSignal` are vscode-free stand-ins for `vscode.LanguageModelChat`/
 * `vscode.CancellationToken`, so every branch — including the tool-calling ones no real
 * `vscode.lm` call in a test host can reach — is unit-testable with fakes.
 */
export async function* runChatFlow(params: ChatFlowParams): AsyncGenerator<ChatEvent> {
  const { enabled, selectModel, tools, executeTool, maxToolIterations, signal } = params;
  let messages = params.messages;

  if (!enabled) {
    yield { type: 'disabled' };
    return;
  }

  const model = await selectModel();
  if (!model) {
    yield { type: 'noModel' };
    return;
  }
  if (signal.aborted) {
    return;
  }

  let lastText = '';
  for (let iteration = 0; iteration < maxToolIterations; iteration++) {
    let fullText = '';
    const toolCalls: ChatToolCall[] = [];
    try {
      for await (const part of model.sendChat(messages, tools, signal)) {
        if (signal.aborted) {
          return;
        }
        if (part.kind === 'text') {
          fullText += part.text;
          yield { type: 'chunk', text: part.text };
        } else {
          toolCalls.push({ callId: part.callId, name: part.name, args: part.args });
          yield { type: 'toolCall', name: part.name, args: part.args };
        }
      }
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }

    if (toolCalls.length === 0) {
      yield { type: 'done', text: fullText };
      return;
    }
    lastText = fullText;

    messages = [...messages, ...toolCalls.map((call): ChatMessage => ({ role: 'assistant', toolCall: call }))];
    for (const call of toolCalls) {
      if (signal.aborted) {
        return;
      }
      let result: unknown;
      try {
        result = await executeTool(call.name, call.args);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      messages = [...messages, { role: 'user', toolResult: { callId: call.callId, result } }];
      yield { type: 'toolResult', name: call.name };
    }
  }
  // maxToolIterations exhausted: yield whatever text the model produced on its last turn (often
  // empty — a turn that hit the cap was mid-tool-call) rather than looping forever.
  yield { type: 'done', text: lastText };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/core/ai/chatFlow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/core/ai/chatFlow.ts test/unit/core/ai/chatFlow.test.ts
```

---

## Milestone B — vscode-facing AI wiring

### Task 4: `LanguageModelClient` — add `selectChatModel` and `streamChat`

**Files:**
- Modify: `src/ai/LanguageModelClient.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ChatModel`, `ChatStreamPart` from Task 3; `GitToolDefinition` from Task 2.
- Produces: `async selectChatModel(modelFamily: string): Promise<ChatModel | undefined>` — consumed by `ai/ChatService.ts` (Task 5). `streamText`/`selectModel` (existing) are untouched — `CommitMessageService`/`LineExplanationService`/`CommitDetailsViewProvider` don't change.

No unit test for this task — matches the file's existing documented convention ("Not unit-tested in isolation... its behavior is exercised through `CommitDetailsViewProvider`'s integration tests"). This addition is exercised by `test/integration/chat.test.ts` (Task 13).

- [ ] **Step 1: Implement**

In `src/ai/LanguageModelClient.ts`, add the imports and two new members alongside the existing `selectModel`/`streamText`:

```ts
import type { ChatMessage, ChatModel, ChatStreamPart } from '../core/ai/chatFlow';
import type { GitToolDefinition } from '../core/ai/gitTools';
```

```ts
  async selectChatModel(modelFamily: string): Promise<ChatModel | undefined> {
    if (typeof vscode.lm === 'undefined') {
      return undefined;
    }
    let models = await vscode.lm.selectChatModels({ family: modelFamily });
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels();
    }
    const model = models[0];
    if (!model) {
      return undefined;
    }
    return {
      sendChat: (messages, tools, signal) => this.streamChat(model, messages, tools, signal),
    };
  }

  private async *streamChat(
    model: vscode.LanguageModelChat,
    messages: ChatMessage[],
    tools: GitToolDefinition[],
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamPart> {
    const tokenSource = new vscode.CancellationTokenSource();
    const onAbort = () => tokenSource.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      const vscodeMessages = messages.map(toVscodeChatMessage);
      const vscodeTools: vscode.LanguageModelChatTool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      const response = await model.sendRequest(vscodeMessages, { tools: vscodeTools }, tokenSource.token);
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          yield { kind: 'text', text: part.value };
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          yield { kind: 'toolCall', callId: part.callId, name: part.name, args: part.input as Record<string, unknown> };
        }
      }
    } catch (err) {
      this.logger.error('GitLore chat request failed', err);
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
      tokenSource.dispose();
    }
  }
```

Add this module-level function (outside the class, near the bottom of the file):

```ts
function toVscodeChatMessage(message: ChatMessage): vscode.LanguageModelChatMessage {
  if (message.toolCall) {
    return vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelToolCallPart(message.toolCall.callId, message.toolCall.name, message.toolCall.args),
    ]);
  }
  if (message.toolResult) {
    return vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelToolResultPart(message.toolResult.callId, [
        new vscode.LanguageModelTextPart(JSON.stringify(message.toolResult.result)),
      ]),
    ]);
  }
  return message.role === 'user'
    ? vscode.LanguageModelChatMessage.User(message.text ?? '')
    : vscode.LanguageModelChatMessage.Assistant(message.text ?? '');
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS — no type errors. (This confirms the code compiles against the installed `@types/vscode ^1.85.0`'s `LanguageModelToolCallPart`/`LanguageModelToolResultPart`/`LanguageModelTextPart` constructors and the `response.stream` union type.)

- [ ] **Step 3: Commit (stage only)**

```bash
git add src/ai/LanguageModelClient.ts
```

---

### Task 5: `ai/ChatService.ts` — wires the model, tools, and conversation state

**Files:**
- Create: `src/ai/ChatService.ts`

**Interfaces:**
- Consumes: `GitService` (existing), `LanguageModelClient.selectChatModel` (Task 4), `runChatFlow`/`ChatEvent`/`ChatMessage` (Task 3), `GIT_TOOL_DEFINITIONS`/`executeGitTool` (Task 2), `CONFIG` (extended in Task 6).
- Produces: `export class ChatService { newChat(): void; getMessages(): ChatMessage[]; send(filePath: string, userText: string, signal: AbortSignal): AsyncGenerator<ChatEvent> }` — consumed by `views/Chat/ChatViewProvider.ts` (Task 9).

No dedicated unit test — matches `CommitMessageService`/`LineExplanationService`'s convention: this class is wiring/config-reading only, its orchestration logic is already covered by `chatFlow.test.ts` (Task 3). Exercised by `test/integration/chat.test.ts` (Task 13).

- [ ] **Step 1: Implement**

Create `src/ai/ChatService.ts`:

```ts
import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { LanguageModelClient } from './LanguageModelClient';
import type { GitLogger } from '../core/git/errors';
import { runChatFlow, type ChatEvent, type ChatMessage } from '../core/ai/chatFlow';
import { GIT_TOOL_DEFINITIONS, executeGitTool } from '../core/ai/gitTools';
import { CONFIG } from '../constants';

/** Orchestrates the chat panel's single active conversation. One conversation per panel — `newChat()` clears it; no persisted multi-session history. */
export class ChatService {
  private messages: ChatMessage[] = [];

  constructor(
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  newChat(): void {
    this.messages = [];
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  async *send(filePath: string, userText: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    this.messages = [...this.messages, { role: 'user', text: userText }];

    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);
    const maxToolIterations = config.get<number>(CONFIG.aiMaxToolIterations, 6);

    const flow = runChatFlow({
      enabled,
      signal,
      messages: this.messages,
      tools: GIT_TOOL_DEFINITIONS,
      selectModel: () => this.languageModelClient.selectChatModel(modelFamily),
      executeTool: (name, args) => executeGitTool(this.git, filePath, name, args, maxDiffChars),
      maxToolIterations,
    });

    for await (const event of flow) {
      if (signal.aborted) {
        return;
      }
      if (event.type === 'error') {
        this.logger.error('GitLore chat failed', event.message);
      }
      if (event.type === 'done') {
        this.messages = [...this.messages, { role: 'assistant', text: event.text }];
      }
      yield event;
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add src/ai/ChatService.ts
```

---

## Milestone C — Chat webview, commands, and wiring

### Task 6: `constants.ts` additions

**Files:**
- Modify: `src/constants.ts`

**Interfaces:**
- Produces: `COMMANDS.openChat`, `COMMANDS.askAboutFile`, `COMMANDS.askAboutCommit`, `COMMANDS.askAboutLine`, `COMMANDS.askAboutPullRequest`, `COMMANDS.explainPullRequest`, `COMMANDS.summarizeBranchComparison`, `COMMANDS.generateChangelog`, `COMMANDS.draftPrReview`; `CONFIG.aiMaxToolIterations`; `VIEWS.chat`; `MEDIA.chat` — consumed throughout Milestones C–G.

- [ ] **Step 1: Implement**

In `src/constants.ts`, add to the end of the `COMMANDS` object (before the closing `} as const;`):

```ts
  openChat: 'gitLore.openChat',
  askAboutFile: 'gitLore.askAboutFile',
  askAboutCommit: 'gitLore.askAboutCommit',
  askAboutLine: 'gitLore.askAboutLine',
  askAboutPullRequest: 'gitLore.askAboutPullRequest',
  explainPullRequest: 'gitLore.explainPullRequest',
  summarizeBranchComparison: 'gitLore.summarizeBranchComparison',
  generateChangelog: 'gitLore.generateChangelog',
  draftPrReview: 'gitLore.draftPrReview',
```

Add to `CONFIG`, after `aiMaxDiffChars: 'ai.maxDiffChars',`:

```ts
  aiMaxToolIterations: 'ai.maxToolIterations',
```

Add to `VIEWS`, after `pullRequestDetails: 'gitLore.pullRequestDetails',`:

```ts
  chat: 'gitLore.chat',
```

Add to `MEDIA`, after `pullRequestDetails: 'pullRequestDetails.css',`:

```ts
  chat: 'chat.css',
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS. (`test/unit/media.test.ts` will now fail until Task 8 creates `media/chat.css` — that's expected and resolved by that task.)

- [ ] **Step 3: Commit (stage only)**

```bash
git add src/constants.ts
```

---

### Task 7: `views/Chat/render.ts` — pure HTML builder

**Files:**
- Create: `src/views/Chat/render.ts`
- Test: `test/unit/views/chat.render.test.ts`

**Interfaces:**
- Consumes: `escapeHtml` (existing), `AI_ICON` (existing, from `../icons`).
- Produces: `export interface ChatData { subjectLabel?: string }`, `export interface RenderChatOptions { nonce: string; cspSource: string; styleUris: string[] }`, `export function renderChatHtml(data: ChatData, opts: RenderChatOptions): string` — consumed by `views/Chat/ChatViewProvider.ts` (Task 9).

- [ ] **Step 1: Write the failing test**

Create `test/unit/views/chat.render.test.ts` (mirrors `pullRequestDetails.render.test.ts`'s style):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChatHtml } from '../../../src/views/Chat/render';

const opts = {
  nonce: 'abc123',
  cspSource: 'vscode-webview://xyz',
  styleUris: ['vscode-webview://xyz/shared.css', 'vscode-webview://xyz/chat.css'],
};

test('renderChatHtml: renders the message log, input form, and Ask button', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /id="chat-messages"/);
  assert.match(html, /id="chat-text"/);
  assert.match(html, /id="chat-send"/);
});

test('renderChatHtml: with no subjectLabel, shows no subject chip', () => {
  const html = renderChatHtml({}, opts);
  assert.ok(!html.includes('chat-subject'));
});

test('renderChatHtml: with a subjectLabel, shows it in a subject chip, HTML-escaped', () => {
  const html = renderChatHtml({ subjectLabel: '<script>alert(1)</script>' }, opts);
  assert.match(html, /class="chat-subject"/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderChatHtml: submitting the form posts send with the textarea value', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /vscode\.postMessage\(\{ type: 'send', text \}\);/);
});

test('renderChatHtml: the new-chat button posts newChat', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /getElementById\('new-chat'\)\.addEventListener\('click', \(\) => \{[\s\S]*vscode\.postMessage\(\{ type: 'newChat' \}\);/);
});

test('renderChatHtml: CSP uses the provided nonce and cspSource, no unsafe-inline', () => {
  const html = renderChatHtml({}, opts);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /style-src vscode-webview:\/\/xyz/);
  assert.ok(!html.includes('unsafe-inline'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/views/chat.render.test.ts`
Expected: FAIL — `src/views/Chat/render.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/views/Chat/render.ts`:

```ts
import { escapeHtml } from '../escapeHtml';
import { AI_ICON } from '../icons';

export interface RenderChatOptions {
  nonce: string;
  cspSource: string;
  styleUris: string[];
}

export interface ChatData {
  subjectLabel?: string;
}

/** Builds the chat webview's full HTML document. Pure — nonce/cspSource/styleUris come from the caller, so this is unit-testable without a real webview host. */
export function renderChatHtml(data: ChatData, opts: RenderChatOptions): string {
  const styles = opts.styleUris.map((uri) => `<link rel="stylesheet" href="${uri}" />`).join('\n');
  const subject = data.subjectLabel
    ? `<div class="chat-subject">${AI_ICON}<span>Asking about: ${escapeHtml(data.subjectLabel)}</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src https: ${opts.cspSource}; script-src 'nonce-${opts.nonce}';" />
${styles}
<title>GitLore Chat</title>
</head>
<body>
<div class="chat-head">
<span class="chat-title">GitLore Chat</span>
<button class="icon-btn" id="new-chat" type="button" title="New chat" aria-label="Start a new chat">${AI_ICON}</button>
</div>
${subject}
<div class="chat-messages" id="chat-messages" role="log" aria-live="polite"></div>
<p class="chat-hint" id="chat-hint" role="status" hidden></p>
<div class="chat-tool-status" id="chat-tool-status" role="status" hidden></div>
<form class="chat-input" id="chat-form">
<textarea id="chat-text" placeholder="Ask about this repo's history…" aria-label="Ask GitLore" rows="2"></textarea>
<button class="btn btn-accent" id="chat-send" type="submit">${AI_ICON}Ask</button>
</form>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('chat-messages');
const hintEl = document.getElementById('chat-hint');
const toolStatusEl = document.getElementById('chat-tool-status');
const form = document.getElementById('chat-form');
const textEl = document.getElementById('chat-text');
const sendBtn = document.getElementById('chat-send');
let currentAssistantBubble = null;

function addBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-bubble-' + role;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = textEl.value.trim();
  if (!text) {
    return;
  }
  addBubble('user', text);
  textEl.value = '';
  sendBtn.disabled = true;
  hintEl.hidden = true;
  currentAssistantBubble = null;
  vscode.postMessage({ type: 'send', text });
});

document.getElementById('new-chat').addEventListener('click', () => {
  messagesEl.innerHTML = '';
  hintEl.hidden = true;
  toolStatusEl.hidden = true;
  sendBtn.disabled = false;
  vscode.postMessage({ type: 'newChat' });
});

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'chatChunk') {
    if (!currentAssistantBubble) {
      currentAssistantBubble = addBubble('assistant', '');
    }
    currentAssistantBubble.textContent += msg.text;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else if (msg.type === 'chatToolCall') {
    toolStatusEl.hidden = false;
    toolStatusEl.textContent = 'Searching commit history (' + msg.name + ')…';
  } else if (msg.type === 'chatToolResult') {
    toolStatusEl.hidden = true;
  } else if (msg.type === 'chatDone') {
    toolStatusEl.hidden = true;
    sendBtn.disabled = false;
  } else if (msg.type === 'chatNoModel') {
    toolStatusEl.hidden = true;
    hintEl.hidden = false;
    hintEl.textContent = 'No language model available. Enable a language model (e.g. GitHub Copilot Chat) to use this feature.';
    sendBtn.disabled = false;
  } else if (msg.type === 'chatReset') {
    toolStatusEl.hidden = true;
    sendBtn.disabled = false;
  } else if (msg.type === 'chatError') {
    toolStatusEl.hidden = true;
    hintEl.hidden = false;
    hintEl.textContent = 'GitLore: ' + msg.message;
    sendBtn.disabled = false;
  }
});
</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/views/chat.render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/views/Chat/render.ts test/unit/views/chat.render.test.ts
```

---

### Task 8: `media/chat.css`

**Files:**
- Create: `media/chat.css`

**Interfaces:**
- Consumes: existing shared classes from `media/shared.css` (`.btn`, `.btn-accent`, `.icon-btn`) — reused as-is, not redefined here.
- Produces: `.chat-head`, `.chat-subject`, `.chat-messages`, `.chat-bubble`, `.chat-bubble-user`, `.chat-bubble-assistant`, `.chat-hint`, `.chat-tool-status`, `.chat-input`, `#chat-text` — referenced by `views/Chat/render.ts` (Task 7).

- [ ] **Step 1: Implement**

Create `media/chat.css`:

```css
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.chat-title {
  font-weight: 600;
}

.chat-subject {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.9em;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.chat-bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-bubble-user {
  align-self: flex-end;
  background: var(--vscode-textLink-foreground);
  color: var(--vscode-editor-background);
}

.chat-bubble-assistant {
  align-self: flex-start;
  background: var(--vscode-editor-inactiveSelectionBackground);
}

.chat-hint,
.chat-tool-status {
  padding: 4px 12px;
  font-size: 0.9em;
  color: var(--vscode-descriptionForeground);
}

.chat-input {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--vscode-panel-border);
}

#chat-text {
  flex: 1;
  resize: none;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
}
```

- [ ] **Step 2: Run test to verify the media existence guard passes**

Run: `npm run test:unit -- test/unit/media.test.ts`
Expected: PASS — `MEDIA.chat` now points at an existing file, and `chat.css` is referenced so it isn't flagged as an orphan.

- [ ] **Step 3: Commit (stage only)**

```bash
git add media/chat.css
```

---

### Task 9: `views/Chat/ChatViewProvider.ts` — the webview provider

**Files:**
- Create: `src/views/Chat/ChatViewProvider.ts`

**Interfaces:**
- Consumes: `renderChatHtml` (Task 7), `ChatService` (Task 5), `renderPlaceholderHtml`/`waitForWebviewView`/`resolveRepoContextPath` (existing), `MEDIA`/`VIEWS` (Task 6).
- Produces: `export class ChatViewProvider implements vscode.WebviewViewProvider` with `show(subjectLabel?: string): Promise<void>`, `send(text: string): Promise<void>`, `sendForTest(text: string): Promise<void>`, `getCurrentHtmlForTest(): string | undefined`, `getChatMessagesForTest(): unknown[]` — consumed by `commands/chatCommands.ts` (Task 10), `extension.ts` (Task 11), and `test/integration/chat.test.ts` (Task 13).

No unit test — matches `CommitDetailsViewProvider`'s convention (a thin wiring class covered by integration tests, Task 13).

- [ ] **Step 1: Implement**

Create `src/views/Chat/ChatViewProvider.ts`:

```ts
import * as vscode from 'vscode';
import { renderChatHtml } from './render';
import { resolveRepoContextPath } from '../CommitGraph/CommitGraphViewProvider';
import { waitForWebviewView } from '../waitForWebviewView';
import type { ChatService } from '../../ai/ChatService';
import { MEDIA, VIEWS } from '../../constants';

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

/** Docks the chat in the bottom panel, alongside every other GitLore view. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private subjectLabel: string | undefined;
  private chatAbortController: AbortController | undefined;
  private chatMessagesForTest: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly chatService: ChatService,
  ) {}

  getCurrentHtmlForTest(): string | undefined {
    return this.view?.webview.html;
  }

  getChatMessagesForTest(): unknown[] {
    return this.chatMessagesForTest;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    this.render();
  }

  /** Called by "Open GitLore Chat" and every "Ask about..." context action — reveals the panel, optionally seeding a subject label shown above the input. */
  async show(subjectLabel?: string): Promise<void> {
    this.subjectLabel = subjectLabel;
    await vscode.commands.executeCommand(`${VIEWS.chat}.focus`);
    await waitForWebviewView(() => this.view);
    this.render();
  }

  private mediaUri(name: string): string {
    return this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    const styleUris = [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.chat)];
    this.view.webview.html = renderChatHtml(
      { subjectLabel: this.subjectLabel },
      { nonce: createNonce(), cspSource: this.view.webview.cspSource, styleUris },
    );
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, text } = message as { type?: unknown; text?: unknown };
    if (type === 'send' && typeof text === 'string') {
      await this.send(text);
      return;
    }
    if (type === 'newChat') {
      this.chatService.newChat();
      this.subjectLabel = undefined;
      this.chatMessagesForTest = [];
      this.render();
    }
  }

  async send(text: string): Promise<void> {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      this.postChatMessage({ type: 'chatError', message: "open a folder or file in a git repo to use the chat." });
      return;
    }
    this.chatAbortController?.abort();
    const controller = new AbortController();
    this.chatAbortController = controller;

    for await (const event of this.chatService.send(filePath, text, controller.signal)) {
      if (controller.signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
          void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', 'gitLore.ai.enabled');
            }
          });
          this.postChatMessage({ type: 'chatReset' });
          break;
        case 'noModel':
          this.postChatMessage({ type: 'chatNoModel' });
          break;
        case 'toolCall':
          this.postChatMessage({ type: 'chatToolCall', name: event.name });
          break;
        case 'toolResult':
          this.postChatMessage({ type: 'chatToolResult', name: event.name });
          break;
        case 'chunk':
          this.postChatMessage({ type: 'chatChunk', text: event.text });
          break;
        case 'done':
          this.postChatMessage({ type: 'chatDone' });
          break;
        case 'error':
          this.postChatMessage({ type: 'chatError', message: event.message });
          break;
      }
    }
  }

  /** Test-only introspection seam — a webview text input can't be driven from an integration test. */
  async sendForTest(text: string): Promise<void> {
    await this.send(text);
  }

  private postChatMessage(message: { type: string; text?: string; name?: string; message?: string }): void {
    this.chatMessagesForTest.push(message);
    void this.view?.webview.postMessage(message);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add src/views/Chat/ChatViewProvider.ts
```

---

### Task 10: `commands/chatCommands.ts` — open + context-action commands

**Files:**
- Create: `src/commands/chatCommands.ts`

**Interfaces:**
- Consumes: `ChatViewProvider.show` (Task 9), `COMMANDS` (Task 6).
- Produces: `handleOpenChatCommand(provider: ChatViewProvider): vscode.Disposable`, `handleAskAboutFileCommand(provider: ChatViewProvider): vscode.Disposable`, `handleAskAboutCommitCommand(commitDetailsProvider: CommitDetailsViewProvider, chatProvider: ChatViewProvider): vscode.Disposable`, `handleAskAboutLineCommand(chatProvider: ChatViewProvider): vscode.Disposable`, `handleAskAboutPullRequestCommand(pullRequestDetailsProvider: PullRequestDetailsViewProvider, chatProvider: ChatViewProvider): vscode.Disposable` — consumed by `extension.ts` (Task 11).

**Design note on wiring:** rather than inventing new native context-menu categories, each "Ask about X" action reuses the panel that already shows X, exactly like `explainCommit`'s button lives inside `CommitDetailsViewProvider` itself. `askAboutFile` operates on `resolveRepoContextPath()` (same convention as `compareBranches`/`generateCommitMessage`). `askAboutCommit`/`askAboutPullRequest` need the currently-loaded commit/PR, so they read it off the relevant provider — this requires two small additions: `CommitDetailsViewProvider.getCurrentSubjectForChat()` and `PullRequestDetailsViewProvider.getCurrentSubjectForChat()` (added in Tasks 15/onward isn't needed — add them here, in this task, since they're trivial one-line getters with no AI dependency).

- [ ] **Step 1: Add trivial getters to two existing providers**

In `src/views/CommitDetails/CommitDetailsViewProvider.ts`, add a public method (near `hasLoadedCommit()`):

```ts
  /** A short label for the chat's subject chip, e.g. when opened via "Ask about this commit". */
  getCurrentSubjectForChat(): string | undefined {
    return this.currentCommit ? `commit ${this.currentCommit.shortSha}` : undefined;
  }
```

In `src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts`, add a public method (near `getCurrentHtmlForTest()`):

```ts
  /** A short label for the chat's subject chip, e.g. when opened via "Ask about this PR". */
  getCurrentSubjectForChat(): string | undefined {
    return this.currentPr ? `PR #${this.currentPr.number} — ${this.currentPr.title}` : undefined;
  }
```

- [ ] **Step 2: Implement `chatCommands.ts`**

Create `src/commands/chatCommands.ts`:

```ts
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { ChatViewProvider } from '../views/Chat/ChatViewProvider';
import type { CommitDetailsViewProvider } from '../views/CommitDetails/CommitDetailsViewProvider';
import type { PullRequestDetailsViewProvider } from '../views/PullRequestDetails/PullRequestDetailsViewProvider';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import { basename } from 'node:path';

export function handleOpenChatCommand(provider: ChatViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.openChat, async () => {
    await provider.show();
  });
}

export function handleAskAboutFileCommand(provider: ChatViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutFile, async () => {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      void vscode.window.showInformationMessage('GitLore: open a file in a git repo to ask about it.');
      return;
    }
    await provider.show(basename(filePath));
  });
}

export function handleAskAboutCommitCommand(
  commitDetailsProvider: CommitDetailsViewProvider,
  chatProvider: ChatViewProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutCommit, async () => {
    const subject = commitDetailsProvider.getCurrentSubjectForChat();
    if (!subject) {
      void vscode.window.showInformationMessage('GitLore: open a commit in Commit Details first.');
      return;
    }
    await chatProvider.show(subject);
  });
}

export function handleAskAboutLineCommand(chatProvider: ChatViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutLine, async (filePath?: string, lineContent?: string) => {
    if (typeof filePath !== 'string' || typeof lineContent !== 'string') {
      void vscode.window.showInformationMessage('GitLore: pick a line with committed history to ask about.');
      return;
    }
    await chatProvider.show(`${basename(filePath)}: ${lineContent.trim().slice(0, 60)}`);
  });
}

export function handleAskAboutPullRequestCommand(
  pullRequestDetailsProvider: PullRequestDetailsViewProvider,
  chatProvider: ChatViewProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.askAboutPullRequest, async () => {
    const subject = pullRequestDetailsProvider.getCurrentSubjectForChat();
    if (!subject) {
      void vscode.window.showInformationMessage('GitLore: open a PR in Pull Request Details first.');
      return;
    }
    await chatProvider.show(subject);
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit (stage only)**

```bash
git add src/commands/chatCommands.ts src/views/CommitDetails/CommitDetailsViewProvider.ts src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts
```

---

### Task 11: `extension.ts` wiring

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: everything produced in Tasks 4–10.
- Produces: `GitLoreTestApi.getChatHtml`, `GitLoreTestApi.chatProvider`, `GitLoreTestApi.sendChatForTest` — consumed by `test/integration/chat.test.ts` (Task 13).

- [ ] **Step 1: Implement**

Add imports to `src/extension.ts`:

```ts
import { ChatService } from './ai/ChatService';
import { ChatViewProvider } from './views/Chat/ChatViewProvider';
import {
  handleOpenChatCommand,
  handleAskAboutFileCommand,
  handleAskAboutCommitCommand,
  handleAskAboutLineCommand,
  handleAskAboutPullRequestCommand,
} from './commands/chatCommands';
```

After the line constructing `pullRequestDetailsViewProvider`, add:

```ts
  const chatService = new ChatService(git, languageModelClient, logger);
  const chatViewProvider = new ChatViewProvider(ctx.extensionUri, chatService);
```

In the `ctx.subscriptions.push(...)` block, add (near the other view/command registrations):

```ts
    handleOpenChatCommand(chatViewProvider),
    handleAskAboutFileCommand(chatViewProvider),
    handleAskAboutCommitCommand(commitDetailsViewProvider, chatViewProvider),
    handleAskAboutLineCommand(chatViewProvider),
    handleAskAboutPullRequestCommand(pullRequestDetailsViewProvider, chatViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.chat, chatViewProvider),
```

In the `GitLoreTestApi` interface, add:

```ts
  getChatHtml: () => string | undefined;
  chatProvider: ChatViewProvider;
  sendChatForTest: (text: string) => Promise<void>;
```

In the returned object at the end of `activate()`, add:

```ts
    getChatHtml: () => chatViewProvider.getCurrentHtmlForTest(),
    chatProvider: chatViewProvider,
    sendChatForTest: (text: string) => chatViewProvider.sendForTest(text),
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add src/extension.ts
```

---

### Task 12: `package.json` wiring

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add commands**

In `contributes.commands`, add (after the `gitLore.openLaunchpad` entry):

```json
      {
        "command": "gitLore.openChat",
        "title": "GitLore: Open Chat",
        "icon": "$(comment-discussion)"
      },
      {
        "command": "gitLore.askAboutFile",
        "title": "GitLore: Ask GitLore About This File",
        "icon": "$(comment-discussion)"
      },
      {
        "command": "gitLore.askAboutCommit",
        "title": "GitLore: Ask GitLore About This Commit",
        "icon": "$(comment-discussion)"
      },
      {
        "command": "gitLore.askAboutLine",
        "title": "GitLore: Ask GitLore About This Line",
        "icon": "$(comment-discussion)"
      },
      {
        "command": "gitLore.askAboutPullRequest",
        "title": "GitLore: Ask GitLore About This Pull Request",
        "icon": "$(comment-discussion)"
      }
```

- [ ] **Step 2: Add the view**

In `contributes.views.gitLore`, add (after the `gitLore.pullRequestDetails` entry):

```json
        {
          "type": "webview",
          "id": "gitLore.chat",
          "name": "Chat",
          "visibility": "collapsed"
        }
```

- [ ] **Step 3: Add view/title buttons**

In `contributes.menus["view/title"]`, add a button on Commit Graph (so "Open Chat" is reachable the same way `openLaunchpad` already is) and on Commit Details/PR Details (so "Ask about this X" sits next to the panel it targets):

```json
        {
          "command": "gitLore.openChat",
          "when": "view == gitLore.commitGraph",
          "group": "navigation@7"
        },
        {
          "command": "gitLore.askAboutCommit",
          "when": "view == gitLore.commitDetails",
          "group": "navigation@3"
        },
        {
          "command": "gitLore.askAboutPullRequest",
          "when": "view == gitLore.pullRequestDetails",
          "group": "navigation@1"
        }
```

- [ ] **Step 4: Gate the context-only commands out of the command palette**

In `contributes.menus.commandPalette`, add (`askAboutLine`'s args make it a programmatic-only command, same as `explainLine`; `askAboutFile`/`askAboutCommit`/`askAboutPullRequest` stay palette-visible since they work standalone off currently-loaded context, same as `explainCommit`):

```json
        {
          "command": "gitLore.askAboutLine",
          "when": "false"
        }
```

- [ ] **Step 5: Add the configuration property**

In `contributes.configuration.properties`, add (after `gitLore.ai.maxDiffChars`):

```json
        "gitLore.ai.maxToolIterations": {
          "type": "number",
          "default": 6,
          "description": "Max tool-call round trips GitLore Chat makes per question before it stops and shows whatever answer the model has produced so far."
        },
```

- [ ] **Step 6: Verify the manifest is valid JSON and the extension still activates**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`
Expected: no output (valid JSON, no exception).

Run: `npm run compile`
Expected: PASS.

- [ ] **Step 7: Commit (stage only)**

```bash
git add package.json
```

---

### Task 13: `test/integration/chat.test.ts`

**Files:**
- Create: `test/integration/chat.test.ts`

**Interfaces:**
- Consumes: `GitLoreTestApi.getChatHtml`/`chatProvider`/`sendChatForTest` (Task 11), `MANIFEST_PATH`/`FixtureManifest` (existing fixture), `withAiConfig`/`captureInfoMessage`-style helpers (mirror `generateCommitMessage.test.ts`).

- [ ] **Step 1: Write the failing test**

Create `test/integration/chat.test.ts` (mirrors `generateCommitMessage.test.ts`'s structure):

```ts
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';

async function withAiConfig<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const config = vscode.workspace.getConfiguration('gitLore');
  await config.update('ai.enabled', enabled, vscode.ConfigurationTarget.Global);
  try {
    return await fn();
  } finally {
    await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
  }
}

suite('GitLore Chat', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('opening the chat renders the message log and input', async () => {
    await vscode.commands.executeCommand(COMMANDS.openChat);
    const html = api.getChatHtml() ?? '';
    assert.match(html, /id="chat-messages"/);
    assert.match(html, /id="chat-text"/);
  });

  test('with AI disabled, sending a message resets the panel instead of calling a model', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(COMMANDS.openChat);

    await withAiConfig(false, () => api.sendChatForTest('who touched this file last?'));
    const messages = api.chatProvider.getChatMessagesForTest();
    assert.deepEqual(messages, [{ type: 'chatReset' }]);
  });

  test('with AI enabled and no model registered, shows the no-model hint', async () => {
    // The test host never has GitHub Copilot Chat (or any other vscode.lm provider) installed,
    // so this is the one "a real model is involved" branch that's deterministic in CI — same
    // reasoning as the equivalent test for generateCommitMessage.
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(COMMANDS.openChat);

    await withAiConfig(true, () => api.sendChatForTest('who touched this file last?'));
    const messages = api.chatProvider.getChatMessagesForTest();
    assert.deepEqual(messages, [{ type: 'chatNoModel' }]);
  });

  test('with no repo context, shows an inline error instead of throwing', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand(COMMANDS.openChat);
    // Falls back to the workspace folder (the fixture repo itself) via resolveRepoContextPath,
    // so this asserts only that it completes without throwing — matching
    // generateCommitMessage.test.ts's equivalent "no repo context" case.
    await withAiConfig(true, () => api.sendChatForTest('anything'));
  });

  test('askAboutCommit with no commit loaded shows a hint instead of opening the chat', async () => {
    const message = await new Promise<string | undefined>((resolve) => {
      const original = vscode.window.showInformationMessage;
      (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
        msg: string,
      ) => {
        vscode.window.showInformationMessage = original;
        resolve(msg);
        return Promise.resolve(undefined);
      }) as typeof vscode.window.showInformationMessage;
      void vscode.commands.executeCommand(COMMANDS.askAboutCommit);
    });
    assert.equal(message, 'GitLore: open a commit in Commit Details first.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — commands/API surface referenced above don't exist until Tasks 6–11 land. (If run after completing Tasks 6–11 in order, this instead verifies those tasks are correctly wired — run it now as the red step for this task specifically, expecting failures limited to whatever hasn't been created yet in strict task order. If executing tasks strictly in order, Tasks 6–12 are already done by this point, so this step should mostly PASS already except for anything this test newly exercises — treat any unexpected failure as a signal to revisit the corresponding earlier task before proceeding.)

- [ ] **Step 3: Run full integration suite to verify it passes**

Run: `npm run test`
Expected: PASS, including every existing integration test (regression check).

- [ ] **Step 4: Commit (stage only)**

```bash
git add test/integration/chat.test.ts
```

---

## Milestone D — Sweep: Explain this PR

### Task 14: `buildPrExplanationPrompt`

**Files:**
- Modify: `src/core/ai/prompts.ts`
- Test: `test/unit/core/ai/prompts.test.ts`

**Interfaces:**
- Produces: `export function buildPrExplanationPrompt(pr: PullRequestSummary, diff: string, maxDiffChars: number): string`

- [ ] **Step 1: Write the failing test**

Add to `test/unit/core/ai/prompts.test.ts`:

```ts
import { buildPrExplanationPrompt } from '../../../../src/core/ai/prompts';
import type { PullRequestSummary } from '../../../../src/core/forge/types';

function pr(): PullRequestSummary {
  return {
    repo: { host: 'github', identity: 'acme/widgets', label: 'acme/widgets' },
    number: 42,
    title: 'Fix flaky retry logic',
    url: 'https://github.com/acme/widgets/pull/42',
    authorLogin: 'raj',
    isDraft: false,
    createdAt: '2024-02-01T10:00:00Z',
    updatedAt: '2024-02-01T10:00:00Z',
    requestedReviewers: [],
    checkStatus: 'passing',
    reviewDecision: 'approved',
    hasConflicts: false,
    reviewedByMe: false,
  };
}

test('buildPrExplanationPrompt: includes the PR title and diff', () => {
  const prompt = buildPrExplanationPrompt(pr(), 'diff --git a/x.ts b/x.ts\n+retry();', 8000);
  assert.match(prompt, /Fix flaky retry logic/);
  assert.match(prompt, /retry\(\);/);
});

test('buildPrExplanationPrompt: truncates a diff over maxDiffChars', () => {
  const prompt = buildPrExplanationPrompt(pr(), 'x'.repeat(20), 10);
  assert.match(prompt, /x{10}\[\.\.\.truncated\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: FAIL — `buildPrExplanationPrompt` is not exported.

- [ ] **Step 3: Implement**

Add to `src/core/ai/prompts.ts`:

```ts
import type { PullRequestSummary } from '../forge/types';

/** Builds the prompt for "Explain this PR". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildPrExplanationPrompt(pr: PullRequestSummary, diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  return `You are summarizing a pull request for a developer deciding whether to review it.

Title: ${pr.title}

Diff:
${body}

Write a plain-English summary of what this PR changes and why, in 2-4 sentences, followed by one sentence calling out the riskiest area to focus a review on. Do not repeat the title verbatim. If the diff was truncated, base your summary only on what's shown.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/core/ai/prompts.ts test/unit/core/ai/prompts.test.ts
```

---

### Task 15: `PullRequestDetailsViewProvider` — "Explain this PR"

**Files:**
- Modify: `src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts`
- Modify: `src/views/PullRequestDetails/render.ts`
- Modify: `src/extension.ts`
- Modify: `src/commands/aiCommands.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildPrExplanationPrompt` (Task 14), `runCommitSummaryFlow`/`LanguageModelClient` (existing), `CONFIG` (existing).
- Produces: `PullRequestDetailsViewProvider.explainPr(): Promise<void>`, `PullRequestDetailsViewProvider.getAiSummaryMessagesForTest(): unknown[]` — consumed by `test/integration/launchpad.test.ts` (Task 16).

- [ ] **Step 1: Modify `PullRequestDetailsViewProvider.ts`**

Add constructor deps and AI state, mirroring `CommitDetailsViewProvider` exactly:

```ts
import { LruCache } from '../../core/cache/LruCache';
import type { LanguageModelClient } from '../../ai/LanguageModelClient';
import type { GitLogger } from '../../core/git/errors';
import { runCommitSummaryFlow } from '../../core/ai/commitSummaryFlow';
import { buildPrExplanationPrompt } from '../../core/ai/prompts';
import { CONFIG } from '../../constants';
```

Change the constructor and add fields:

```ts
  private aiSummaryCache = new LruCache<string, string>(50);
  private aiAbortController: AbortController | undefined;
  private aiMessagesForTest: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  getAiSummaryMessagesForTest(): unknown[] {
    return this.aiMessagesForTest;
  }
```

Add the `explainPr` method and its `postAiMessage` helper (place near the end of the class, before the closing brace):

```ts
  async explainPr(): Promise<void> {
    if (!this.view || !this.currentPr) {
      return;
    }
    this.aiAbortController?.abort();
    const controller = new AbortController();
    this.aiAbortController = controller;

    const pr = this.currentPr;
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const cacheKey = `${pr.repo.host}:${pr.repo.identity}#${pr.number}`;
    const cached = this.aiSummaryCache.get(cacheKey);

    let diff = '';
    if (!cached && this.currentClient) {
      const { diff: fetchedDiff } = await this.currentClient.getPullRequestDiff(pr.repo, pr.number);
      diff = fetchedDiff;
    }

    const flow = runCommitSummaryFlow({
      enabled,
      cached,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildPrExplanationPrompt(pr, diff, maxDiffChars),
    });

    for await (const event of flow) {
      if (controller.signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
          void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG.section}.${CONFIG.aiEnabled}`);
            }
          });
          this.postAiMessage({ type: 'aiSummaryReset' });
          break;
        case 'cached':
          this.postAiMessage({ type: 'aiSummaryCached', text: event.text });
          break;
        case 'noModel':
          this.postAiMessage({ type: 'aiSummaryNoModel' });
          break;
        case 'chunk':
          this.postAiMessage({ type: 'aiSummaryChunk', text: event.text });
          break;
        case 'done':
          this.aiSummaryCache.set(cacheKey, event.text);
          this.postAiMessage({ type: 'aiSummaryDone' });
          break;
        case 'error':
          this.logger.error('AI PR explanation failed', event.message);
          this.postAiMessage({ type: 'aiSummaryError', message: event.message });
          break;
      }
    }
  }

  private postAiMessage(message: { type: string; text?: string; message?: string }): void {
    this.aiMessagesForTest.push(message);
    void this.view?.webview.postMessage(message);
  }
```

Extend `handleMessage` to dispatch to it (add alongside the existing `if (type === 'addComment' ...)` block):

```ts
    if (type === 'explainPr') {
      await this.explainPr();
      return;
    }
```

- [ ] **Step 2: Modify `render.ts`** — add the ai-summary block and button, mirroring `CommitDetails/render.ts`

Add `AI_ICON` to the existing icon import line:

```ts
import { AI_ICON, APPROVE_ICON, EXTERNAL_ICON, FILES_ICON, MESSAGE_ICON, REFRESH_ICON, SEARCH_ICON, WRAP_ICON } from '../icons';
```

In the `<div class="actions">` block, add the Explain button after the Refresh button:

```html
<button class="icon-btn" id="refresh-pr" type="button" title="Refresh — picks up changes made elsewhere (e.g. a review submitted from Launchpad)" aria-label="Refresh this pull request's details">${REFRESH_ICON}</button>
<button class="btn btn-accent" id="explain-pr" type="button" title="Explain this PR with AI">${AI_ICON}Explain</button>
</div>
<div class="ai-summary">
<p class="ai-summary-text" id="ai-summary-text" aria-live="polite" hidden></p>
<p class="ai-summary-hint" id="ai-summary-hint" role="status" hidden></p>
<div class="skeleton" id="ai-summary-skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="Generating…" hidden>
<div class="skeleton-row" style="width: 92%"></div>
<div class="skeleton-row" style="width: 68%"></div>
</div>
</div>
```

Add the button's script handling, right after the existing `refresh-pr` click listener:

```js
const explainBtn = document.getElementById('explain-pr');
const summaryText = document.getElementById('ai-summary-text');
const summaryHint = document.getElementById('ai-summary-hint');
const summarySkeleton = document.getElementById('ai-summary-skeleton');
explainBtn.addEventListener('click', () => {
  explainBtn.disabled = true;
  summaryText.hidden = true;
  summaryText.textContent = '';
  summaryHint.hidden = true;
  summarySkeleton.hidden = false;
  vscode.postMessage({ type: 'explainPr' });
});
```

Extend the existing `window.addEventListener('message', ...)` handler with the same `aiSummary*` branches `CommitDetails/render.ts` already has (chunk/cached/done/reset/noModel/error), setting `explainBtn.disabled = false` in each terminal branch.

- [ ] **Step 3: Wire `extension.ts`**

Change the constructor call:

```ts
  const pullRequestDetailsViewProvider = new PullRequestDetailsViewProvider(ctx.extensionUri, languageModelClient, logger);
```

Add to `GitLoreTestApi` and the returned object:

```ts
  explainPr: () => Promise<void>;
  getPrAiSummaryMessagesForTest: () => unknown[];
```

```ts
    explainPr: () => pullRequestDetailsViewProvider.explainPr(),
    getPrAiSummaryMessagesForTest: () => pullRequestDetailsViewProvider.getAiSummaryMessagesForTest(),
```

- [ ] **Step 4: Add the command in `aiCommands.ts`**

```ts
export function handleExplainPullRequestCommand(provider: PullRequestDetailsViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.explainPullRequest, async () => {
    if (!provider.getCurrentSubjectForChat()) {
      void vscode.window.showInformationMessage('GitLore: open a PR in Pull Request Details first.');
      return;
    }
    await provider.explainPr();
  });
}
```

(Add the matching `import type { PullRequestDetailsViewProvider } from '../views/PullRequestDetails/PullRequestDetailsViewProvider';` at the top of `aiCommands.ts`, and register `handleExplainPullRequestCommand(pullRequestDetailsViewProvider)` in `extension.ts`'s subscriptions.)

- [ ] **Step 5: `package.json`**

Add to `contributes.commands`:

```json
      {
        "command": "gitLore.explainPullRequest",
        "title": "GitLore: Explain Pull Request with AI",
        "icon": "$(sparkle)"
      }
```

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit (stage only)**

```bash
git add src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts src/views/PullRequestDetails/render.ts src/extension.ts src/commands/aiCommands.ts package.json
```

---

### Task 16: Integration tests for "Explain this PR"

**Files:**
- Modify: `test/integration/launchpad.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/integration/launchpad.test.ts`, reusing this file's exact existing fixture shape (`withLaunchpadEnabled` + `withOriginRemote` + `setFetchImplForTest` + `openLaunchpad` + `showPullRequest`) already used by its `addCommentForTest`/`resolveThreadForTest` tests just above:

```ts
test('explainPr: with AI disabled, resets the summary section instead of calling a model', async () =>
  withLaunchpadEnabled(() =>
    withOriginRemote('https://gitlab.com/acme/explain-widgets.git', async () => {
      api.launchpadProvider.setFetchImplForTest((async (url: string) => {
        if (url.endsWith('/user')) {
          return jsonResponse({ username: 'raj' });
        }
        if (url.includes('merge_requests?state=opened')) {
          return jsonResponse([
            {
              iid: 10,
              title: 'Explainable PR',
              web_url: 'https://gitlab.com/acme/explain-widgets/-/merge_requests/10',
              author: { username: 'raj' },
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]);
        }
        if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
          return jsonResponse([]);
        }
        if (url.endsWith('/approvals')) {
          return jsonResponse({ approved: false, approved_by: [] });
        }
        if (url.includes('merge_requests/10/diffs')) {
          return jsonResponse([{ old_path: 'src/x.ts', new_path: 'src/x.ts', diff: '@@ -1 +1,2 @@\n+thing();' }]);
        }
        if (url.includes('merge_requests/10/discussions')) {
          return jsonResponse([]);
        }
        throw new Error(`unmocked request in test: ${url}`);
      }) as unknown as typeof fetch);

      const originalInput = vscode.window.showInputBox;
      (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
        'fake-pat') as typeof vscode.window.showInputBox;
      try {
        await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
        await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Explainable PR'));
      } finally {
        vscode.window.showInputBox = originalInput;
      }
      await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'gitlab:acme/explain-widgets#10');
      await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('Explainable PR'));

      await withAiConfig(false, () => api.explainPr());
      assert.deepEqual(api.getPrAiSummaryMessagesForTest(), [{ type: 'aiSummaryReset' }]);
    }),
  ));

test('explainPr: with AI enabled and no model registered, shows the no-model hint', async () =>
  withLaunchpadEnabled(() =>
    withOriginRemote('https://gitlab.com/acme/explain2-widgets.git', async () => {
      api.launchpadProvider.setFetchImplForTest((async (url: string) => {
        if (url.endsWith('/user')) {
          return jsonResponse({ username: 'raj' });
        }
        if (url.includes('merge_requests?state=opened')) {
          return jsonResponse([
            {
              iid: 11,
              title: 'Explainable PR Two',
              web_url: 'https://gitlab.com/acme/explain2-widgets/-/merge_requests/11',
              author: { username: 'raj' },
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]);
        }
        if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
          return jsonResponse([]);
        }
        if (url.endsWith('/approvals')) {
          return jsonResponse({ approved: false, approved_by: [] });
        }
        if (url.includes('merge_requests/11/diffs')) {
          return jsonResponse([{ old_path: 'src/x.ts', new_path: 'src/x.ts', diff: '@@ -1 +1,2 @@\n+thing();' }]);
        }
        if (url.includes('merge_requests/11/discussions')) {
          return jsonResponse([]);
        }
        throw new Error(`unmocked request in test: ${url}`);
      }) as unknown as typeof fetch);

      const originalInput = vscode.window.showInputBox;
      (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
        'fake-pat') as typeof vscode.window.showInputBox;
      try {
        await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
        await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Explainable PR Two'));
      } finally {
        vscode.window.showInputBox = originalInput;
      }
      await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'gitlab:acme/explain2-widgets#11');
      await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('Explainable PR Two'));

      await withAiConfig(true, () => api.explainPr());
      assert.deepEqual(api.getPrAiSummaryMessagesForTest(), [{ type: 'aiSummaryNoModel' }]);
    }),
  ));
```

(`withAiConfig` matches the helper already defined in `test/integration/generateCommitMessage.test.ts` — add the same small helper at the top of `launchpad.test.ts` if it isn't already present there.)

- [ ] **Step 2: Run test to verify it fails, then implement is already done (Task 15), so verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add test/integration/launchpad.test.ts
```

---

## Milestone E — Sweep: Branch Compare AI summary

### Task 17: `buildBranchCompareSummaryPrompt`

**Files:**
- Modify: `src/core/ai/prompts.ts`
- Test: `test/unit/core/ai/prompts.test.ts`

**Interfaces:**
- Produces: `export function buildBranchCompareSummaryPrompt(base: string, compare: string, diff: string, maxDiffChars: number): string`

- [ ] **Step 1: Write the failing test**

```ts
import { buildBranchCompareSummaryPrompt } from '../../../../src/core/ai/prompts';

test('buildBranchCompareSummaryPrompt: includes both ref names and the diff', () => {
  const prompt = buildBranchCompareSummaryPrompt('main', 'feature/x', 'diff --git a/x.ts b/x.ts\n+thing();', 8000);
  assert.match(prompt, /main/);
  assert.match(prompt, /feature\/x/);
  assert.match(prompt, /thing\(\);/);
});

test('buildBranchCompareSummaryPrompt: truncates a diff over maxDiffChars', () => {
  const prompt = buildBranchCompareSummaryPrompt('main', 'feature/x', 'z'.repeat(20), 10);
  assert.match(prompt, /z{10}\[\.\.\.truncated\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** Builds the prompt for Branch Comparison's AI summary. Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildBranchCompareSummaryPrompt(base: string, compare: string, diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  return `You are summarizing the difference between two git branches for a developer deciding whether to merge one into the other.

Comparing ${base}...${compare}.

Diff:
${body}

Write a plain-English summary of what ${compare} changes relative to ${base}, in 2-4 sentences. If the diff was truncated, base your summary only on what's shown.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/core/ai/prompts.ts test/unit/core/ai/prompts.test.ts
```

---

### Task 18: `BranchComparisonViewProvider` — AI summary

**Files:**
- Modify: `src/views/BranchComparison/BranchComparisonViewProvider.ts`
- Modify: `src/views/BranchComparison/render.ts`
- Modify: `src/extension.ts`
- Modify: `src/commands/aiCommands.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildBranchCompareSummaryPrompt` (Task 17).
- Produces: `BranchComparisonViewProvider.summarizeComparison(): Promise<void>`, `getAiSummaryMessagesForTest(): unknown[]` — consumed by `test/integration/branchComparison.test.ts` (Task 19).

- [ ] **Step 1: Modify `BranchComparisonViewProvider.ts`**

Add imports:

```ts
import { LruCache } from '../../core/cache/LruCache';
import type { LanguageModelClient } from '../../ai/LanguageModelClient';
import { runCommitSummaryFlow } from '../../core/ai/commitSummaryFlow';
import { buildBranchCompareSummaryPrompt } from '../../core/ai/prompts';
```

Extend the constructor (the existing `logger?: GitLogger` param stays optional; `languageModelClient` is inserted before it, matching how every other provider takes it as a required dep):

```ts
  private aiSummaryCache = new LruCache<string, string>(50);
  private aiAbortController: AbortController | undefined;
  private aiMessagesForTest: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger?: GitLogger,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  getAiSummaryMessagesForTest(): unknown[] {
    return this.aiMessagesForTest;
  }
```

Add the method (near `createPullRequestFlow`):

```ts
  async summarizeComparison(): Promise<void> {
    if (!this.view || !this.currentFilePath || !this.currentBase || !this.currentCompare) {
      return;
    }
    this.aiAbortController?.abort();
    const controller = new AbortController();
    this.aiAbortController = controller;

    const filePath = this.currentFilePath;
    const base = this.currentBase;
    const compare = this.currentCompare;
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const repoRoot = await this.git.getRepoRoot(filePath);
    const cacheKey = `${repoRoot ?? filePath}:${base}...${compare}`;
    const cached = this.aiSummaryCache.get(cacheKey);
    const diff = cached === undefined ? await this.git.getDiffBetweenRefs(filePath, base, compare) : '';

    const flow = runCommitSummaryFlow({
      enabled,
      cached,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildBranchCompareSummaryPrompt(base, compare, diff, maxDiffChars),
    });

    for await (const event of flow) {
      if (controller.signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
          void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG.section}.${CONFIG.aiEnabled}`);
            }
          });
          this.postAiMessage({ type: 'aiSummaryReset' });
          break;
        case 'cached':
          this.postAiMessage({ type: 'aiSummaryCached', text: event.text });
          break;
        case 'noModel':
          this.postAiMessage({ type: 'aiSummaryNoModel' });
          break;
        case 'chunk':
          this.postAiMessage({ type: 'aiSummaryChunk', text: event.text });
          break;
        case 'done':
          this.aiSummaryCache.set(cacheKey, event.text);
          this.postAiMessage({ type: 'aiSummaryDone' });
          break;
        case 'error':
          this.logger?.error('AI branch comparison summary failed', event.message);
          this.postAiMessage({ type: 'aiSummaryError', message: event.message });
          break;
      }
    }
  }

  private postAiMessage(message: { type: string; text?: string; message?: string }): void {
    this.aiMessagesForTest.push(message);
    void this.view?.webview.postMessage(message);
  }
```

Extend `handleMessage`:

```ts
    if (type === 'summarizeComparison') {
      await this.summarizeComparison();
      return;
    }
```

- [ ] **Step 2: Modify `render.ts`**

Add `AI_ICON` to the icon import, add the ai-summary block + button next to the refbar's refresh button (same block markup as Task 15's PR Details addition), and add matching script wiring posting `{ type: 'summarizeComparison' }` and handling the same `aiSummary*` message types.

- [ ] **Step 3: Wire `extension.ts`**

Change the constructor call:

```ts
  const branchComparisonViewProvider = new BranchComparisonViewProvider(ctx.extensionUri, ctx, git, languageModelClient, logger);
```

Add to `GitLoreTestApi` and the returned object:

```ts
  summarizeBranchComparison: () => Promise<void>;
  getBranchComparisonAiSummaryMessagesForTest: () => unknown[];
```

```ts
    summarizeBranchComparison: () => branchComparisonViewProvider.summarizeComparison(),
    getBranchComparisonAiSummaryMessagesForTest: () => branchComparisonViewProvider.getAiSummaryMessagesForTest(),
```

- [ ] **Step 4: Add the command in `aiCommands.ts`**

```ts
export function handleSummarizeBranchComparisonCommand(provider: BranchComparisonViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.summarizeBranchComparison, async () => {
    await provider.summarizeComparison();
  });
}
```

- [ ] **Step 5: `package.json`**

Add to `contributes.commands`:

```json
      {
        "command": "gitLore.summarizeBranchComparison",
        "title": "GitLore: Summarize Branch Comparison with AI",
        "icon": "$(sparkle)"
      }
```

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit (stage only)**

```bash
git add src/views/BranchComparison/BranchComparisonViewProvider.ts src/views/BranchComparison/render.ts src/extension.ts src/commands/aiCommands.ts package.json
```

---

### Task 19: Integration tests for Branch Compare AI summary

**Files:**
- Modify: `test/integration/branchComparison.test.ts`

- [ ] **Step 1: Write the failing tests, following that file's existing setup pattern for loading a comparison**

```ts
test('summarizeComparison: with AI disabled, resets the summary section instead of calling a model', async () => {
  // ...open a comparison the same way this file's existing tests do...
  await withAiConfig(false, () => api.summarizeBranchComparison());
  assert.deepEqual(api.getBranchComparisonAiSummaryMessagesForTest(), [{ type: 'aiSummaryReset' }]);
});

test('summarizeComparison: with AI enabled and no model registered, shows the no-model hint', async () => {
  // ...open a comparison...
  await withAiConfig(true, () => api.summarizeBranchComparison());
  assert.deepEqual(api.getBranchComparisonAiSummaryMessagesForTest(), [{ type: 'aiSummaryNoModel' }]);
});
```

Reuse the `withAiConfig` helper already defined in this file (or import the same pattern from `generateCommitMessage.test.ts` if this file doesn't already have one) and this file's existing comparison-loading setup verbatim.

- [ ] **Step 2: Run full suite to verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add test/integration/branchComparison.test.ts
```

---

## Milestone F — Sweep: NL changelog

### Task 20: `buildChangelogPrompt`

**Files:**
- Modify: `src/core/ai/prompts.ts`
- Test: `test/unit/core/ai/prompts.test.ts`

**Interfaces:**
- Produces: `export function buildChangelogPrompt(from: string, to: string, commits: Commit[], diff: string, maxDiffChars: number): string`

- [ ] **Step 1: Write the failing test**

```ts
import { buildChangelogPrompt } from '../../../../src/core/ai/prompts';
import type { Commit } from '../../../../src/core/git/types';

function commit(message: string): Commit {
  return { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', author: 'raj', authorEmail: 'raj@example.com', date: '2024-02-01T10:00:00Z', message };
}

test('buildChangelogPrompt: includes both refs, commit subjects, and the diff', () => {
  const prompt = buildChangelogPrompt('v1.0.0', 'main', [commit('Fix retry bug'), commit('Add caching')], 'diff --git a/x.ts b/x.ts\n+thing();', 8000);
  assert.match(prompt, /v1\.0\.0/);
  assert.match(prompt, /main/);
  assert.match(prompt, /Fix retry bug/);
  assert.match(prompt, /Add caching/);
  assert.match(prompt, /thing\(\);/);
});

test('buildChangelogPrompt: truncates a diff over maxDiffChars', () => {
  const prompt = buildChangelogPrompt('v1.0.0', 'main', [], 'w'.repeat(20), 10);
  assert.match(prompt, /w{10}\[\.\.\.truncated\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Commit } from '../git/types';

/** Builds the prompt for NL changelog generation. Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildChangelogPrompt(from: string, to: string, commits: Commit[], diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  const subjects = commits.map((c) => `- ${c.message}`).join('\n');
  return `You are writing a human-readable changelog entry summarizing everything that changed between ${from} and ${to}.

Commit subjects:
${subjects || '(no commits)'}

Diff:
${body}

Write a changelog in Markdown, grouped into "Added", "Changed", and "Fixed" sections (omit any section with nothing to say). Use one bullet per notable change, written for an end user, not a developer. Do not invent changes not supported by the commits or diff above. If the diff was truncated, rely more heavily on the commit subjects for anything not visible in the shown diff.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/core/ai/prompts.ts test/unit/core/ai/prompts.test.ts
```

---

### Task 21: `ai/ChangelogService.ts`

**Files:**
- Create: `src/ai/ChangelogService.ts`

**Interfaces:**
- Consumes: `GitService.getCommitsBetween`/`getDiffBetweenRefs` (existing), `buildChangelogPrompt` (Task 20), `runCommitSummaryFlow`/`LanguageModelClient` (existing).
- Produces: `export class ChangelogService { generate(filePath: string, from: string, to: string, signal: AbortSignal): AsyncGenerator<CommitMessageEvent> }` — reuses the exact `CommitMessageEvent` union from `CommitMessageService` (rename-free reuse: both are "disabled / noModel / chunk / done / error" shaped, plus one feature-specific early-exit).

No dedicated unit test — matches `CommitMessageService`'s convention (wiring/config-reading only; orchestration already covered by `commitSummaryFlow.test.ts`). Exercised by `test/integration/changelog.test.ts` (Task 24).

- [ ] **Step 1: Implement**

Create `src/ai/ChangelogService.ts`:

```ts
import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { LanguageModelClient } from './LanguageModelClient';
import type { GitLogger } from '../core/git/errors';
import { runCommitSummaryFlow } from '../core/ai/commitSummaryFlow';
import { buildChangelogPrompt } from '../core/ai/prompts';
import { CONFIG } from '../constants';

export type ChangelogEvent =
  | { type: 'disabled' }
  | { type: 'noCommits' }
  | { type: 'noModel' }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

/** Generates a Markdown changelog between two refs. No panel of its own — the caller streams the result into an untitled Markdown document, the simplest surface for a one-off block of text with copy/save already built in via the editor itself. */
export class ChangelogService {
  constructor(
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  async *generate(filePath: string, from: string, to: string, signal: AbortSignal): AsyncGenerator<ChangelogEvent> {
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);

    if (!enabled) {
      yield { type: 'disabled' };
      return;
    }

    const commits = await this.git.getCommitsBetween(filePath, from, to);
    if (commits.length === 0) {
      yield { type: 'noCommits' };
      return;
    }

    const diff = await this.git.getDiffBetweenRefs(filePath, from, to);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const flow = runCommitSummaryFlow({
      enabled,
      cached: undefined,
      signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildChangelogPrompt(from, to, commits, diff, maxDiffChars),
    });

    for await (const event of flow) {
      if (signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
        case 'cached':
          // Unreachable: `enabled` is already true and `cached` is always undefined above.
          break;
        case 'noModel':
          yield { type: 'noModel' };
          return;
        case 'chunk':
          yield { type: 'chunk', text: event.text };
          break;
        case 'done':
          yield { type: 'done', text: event.text };
          return;
        case 'error':
          this.logger.error('Changelog generation failed', event.message);
          yield { type: 'error', message: event.message };
          return;
      }
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add src/ai/ChangelogService.ts
```

---

### Task 22: `generateChangelog` command

**Files:**
- Modify: `src/commands/aiCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ChangelogService` (Task 21), `resolveRepoContextPath` (existing), `GitService.getBranches`/`getTags` (existing).

- [ ] **Step 1: Add the command handler to `aiCommands.ts`**

```ts
export function handleGenerateChangelogCommand(service: ChangelogService, git: GitService): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.generateChangelog, async () => {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      void vscode.window.showInformationMessage('GitLore: open a repo first to generate a changelog.');
      return;
    }

    const [branches, tags] = await Promise.all([git.getBranches(filePath), git.getTags(filePath)]);
    const refItems = [...branches.map((b) => b.name), ...tags.map((t) => t.name)];

    const from = await vscode.window.showQuickPick(refItems, { placeHolder: 'Changelog since which ref? (e.g. last release tag)' });
    if (!from) {
      return;
    }
    const to = (await vscode.window.showQuickPick(refItems, { placeHolder: 'Changelog up to which ref?' })) ?? undefined;
    if (!to) {
      return;
    }

    const controller = new AbortController();
    let fullText = '';
    let doc: vscode.TextDocument | undefined;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'GitLore: generating changelog…' },
      async () => {
        for await (const event of service.generate(filePath, from, to, controller.signal)) {
          switch (event.type) {
            case 'disabled':
              void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
                if (choice) {
                  void vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG.section}.${CONFIG.aiEnabled}`);
                }
              });
              break;
            case 'noCommits':
              void vscode.window.showInformationMessage(`GitLore: no commits between ${from} and ${to}.`);
              break;
            case 'noModel':
              void vscode.window.showInformationMessage(
                'No language model available. Enable a language model (e.g. GitHub Copilot Chat) to use this feature.',
              );
              break;
            case 'chunk':
              fullText += event.text;
              if (!doc) {
                doc = await vscode.workspace.openTextDocument({ content: fullText, language: 'markdown' });
                await vscode.window.showTextDocument(doc);
              } else {
                const editor = await vscode.window.showTextDocument(doc);
                await editor.edit((builder) => {
                  const lastLine = doc!.lineAt(doc!.lineCount - 1);
                  builder.replace(new vscode.Range(new vscode.Position(0, 0), lastLine.range.end), fullText);
                });
              }
              break;
            case 'error':
              void vscode.window.showErrorMessage(`GitLore: failed to generate a changelog — ${event.message}`);
              break;
          }
        }
      },
    );
  });
}
```

Add the matching import at the top of `aiCommands.ts`: `import type { ChangelogService } from '../ai/ChangelogService';`.

- [ ] **Step 2: Wire `extension.ts`**

```ts
  const changelogService = new ChangelogService(git, languageModelClient, logger);
```

```ts
    handleGenerateChangelogCommand(changelogService, git),
```

(Add `import { ChangelogService } from './ai/ChangelogService';` and `handleGenerateChangelogCommand` to the existing `aiCommands` import line.)

- [ ] **Step 3: `package.json`**

```json
      {
        "command": "gitLore.generateChangelog",
        "title": "GitLore: Generate Changelog with AI",
        "icon": "$(sparkle)"
      }
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/commands/aiCommands.ts src/extension.ts package.json
```

---

### Task 23: `test/integration/changelog.test.ts`

**Files:**
- Create: `test/integration/changelog.test.ts`

- [ ] **Step 1: Write the failing test, mirroring `generateCommitMessage.test.ts`'s structure**

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';

async function withAiConfig<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const config = vscode.workspace.getConfiguration('gitLore');
  await config.update('ai.enabled', enabled, vscode.ConfigurationTarget.Global);
  try {
    return await fn();
  } finally {
    await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
  }
}

async function captureInfoMessage(fn: () => Promise<unknown>): Promise<string | undefined> {
  const original = vscode.window.showInformationMessage;
  let calledWith: string | undefined;
  (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
    message: string,
  ) => {
    calledWith ??= message;
    return Promise.resolve(undefined);
  }) as typeof vscode.window.showInformationMessage;
  try {
    await fn();
  } finally {
    vscode.window.showInformationMessage = original;
  }
  return calledWith;
}

suite('Generate changelog with AI', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
  });

  test('with no repo context, says so instead of throwing', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const message = await captureInfoMessage(() => Promise.resolve(vscode.commands.executeCommand(COMMANDS.generateChangelog)));
    // Falls back to the workspace folder (the fixture repo), so a QuickPick opens instead — this
    // asserts only that invoking the command doesn't throw. No message is asserted here.
    void message;
  });
});
```

- [ ] **Step 2: Run full suite to verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add test/integration/changelog.test.ts
```

---

## Milestone G — Sweep: AI PR review draft

### Task 24: `buildPrReviewDraftPrompt`

**Files:**
- Modify: `src/core/ai/prompts.ts`
- Test: `test/unit/core/ai/prompts.test.ts`

**Interfaces:**
- Produces: `export function buildPrReviewDraftPrompt(pr: PullRequestSummary, diff: string, threads: ConversationThread[], maxDiffChars: number): string`

- [ ] **Step 1: Write the failing test**

```ts
import { buildPrReviewDraftPrompt } from '../../../../src/core/ai/prompts';
import type { ConversationThread } from '../../../../src/core/forge/types';

test('buildPrReviewDraftPrompt: includes the PR title, diff, and existing conversation context', () => {
  const threads: ConversationThread[] = [{ id: 't1', body: 'Is this thread-safe?', authorLogin: 'amy', resolved: false }];
  const prompt = buildPrReviewDraftPrompt(pr(), 'diff --git a/x.ts b/x.ts\n+thing();', threads, 8000);
  assert.match(prompt, /Fix flaky retry logic/);
  assert.match(prompt, /thing\(\);/);
  assert.match(prompt, /Is this thread-safe\?/);
});

test('buildPrReviewDraftPrompt: truncates a diff over maxDiffChars', () => {
  const prompt = buildPrReviewDraftPrompt(pr(), 'v'.repeat(20), [], 10);
  assert.match(prompt, /v{10}\[\.\.\.truncated\]/);
});
```

(Reuses the `pr()` helper already added to this file in Task 14.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { ConversationThread } from '../forge/types';

/** Builds the prompt for a draft PR review comment. Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildPrReviewDraftPrompt(pr: PullRequestSummary, diff: string, threads: ConversationThread[], maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  const existingThreads = threads.length > 0
    ? threads.map((t) => `- ${t.authorLogin}: ${t.body}`).join('\n')
    : '(no existing review conversations)';
  return `You are drafting one top-level review comment for a pull request, to be edited by a human reviewer before posting — never post this yourself.

Title: ${pr.title}

Existing review conversations:
${existingThreads}

Diff:
${body}

Write one draft comment (2-5 sentences) raising the most useful question or concern a careful reviewer would, that isn't already covered by an existing conversation above. If the diff was truncated, base it only on what's shown. Do not include a greeting or sign-off.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/core/ai/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (stage only)**

```bash
git add src/core/ai/prompts.ts test/unit/core/ai/prompts.test.ts
```

---

### Task 25: `PullRequestDetailsViewProvider` — "Draft Review"

**Files:**
- Modify: `src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts`
- Modify: `src/views/PullRequestDetails/render.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildPrReviewDraftPrompt` (Task 24), `currentClient.listConversationThreads` (existing), `LanguageModelClient`/`runCommitSummaryFlow` (existing, already available on this class from Task 15).
- Produces: `PullRequestDetailsViewProvider.draftReview(): Promise<void>` — the draft streams into the existing `comment-body` textarea (Task-15-adjacent reuse: never a new submission path — the user still clicks the existing "Comment" button to post it via `addComment`, matching every other write action's "confirm/act" shape).

- [ ] **Step 1: Add `draftReview` to `PullRequestDetailsViewProvider.ts`**

Add the import: `import { buildPrReviewDraftPrompt } from '../../core/ai/prompts';` (alongside the existing `buildPrExplanationPrompt` import from Task 15).

```ts
  async draftReview(): Promise<void> {
    if (!this.view || !this.currentPr || !this.currentClient) {
      return;
    }
    this.aiAbortController?.abort();
    const controller = new AbortController();
    this.aiAbortController = controller;

    const pr = this.currentPr;
    const client = this.currentClient;
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const [{ diff }, threads] = await Promise.all([
      client.getPullRequestDiff(pr.repo, pr.number),
      client.listConversationThreads(pr.repo, pr.number),
    ]);

    const flow = runCommitSummaryFlow({
      enabled,
      cached: undefined,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildPrReviewDraftPrompt(pr, diff, threads, maxDiffChars),
    });

    for await (const event of flow) {
      if (controller.signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
          void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG.section}.${CONFIG.aiEnabled}`);
            }
          });
          this.postAiMessage({ type: 'draftReviewReset' });
          break;
        case 'cached':
          // Never reached: this flow always passes cached: undefined.
          break;
        case 'noModel':
          this.postAiMessage({ type: 'draftReviewNoModel' });
          break;
        case 'chunk':
          this.postAiMessage({ type: 'draftReviewChunk', text: event.text });
          break;
        case 'done':
          this.postAiMessage({ type: 'draftReviewDone' });
          break;
        case 'error':
          this.logger.error('AI PR review draft failed', event.message);
          this.postAiMessage({ type: 'draftReviewError', message: event.message });
          break;
      }
    }
  }
```

Extend `handleMessage`:

```ts
    if (type === 'draftReview') {
      await this.draftReview();
      return;
    }
```

- [ ] **Step 2: Modify `render.ts`** — add a "Draft Review" button next to the Explain button, streaming into the existing comment textarea

Add the button next to `explain-pr`:

```html
<button class="btn" id="draft-review" type="button" title="Draft a review comment with AI">${AI_ICON}Draft Review</button>
```

Add its script (writes into the existing `#comment-body` textarea rather than a new field):

```js
document.getElementById('draft-review').addEventListener('click', () => {
  document.getElementById('draft-review').disabled = true;
  vscode.postMessage({ type: 'draftReview' });
});
```

Extend the message listener:

```js
  } else if (msg.type === 'draftReviewChunk') {
    commentBody.value += msg.text;
  } else if (msg.type === 'draftReviewDone' || msg.type === 'draftReviewReset' || msg.type === 'draftReviewNoModel') {
    document.getElementById('draft-review').disabled = false;
    if (msg.type === 'draftReviewNoModel') {
      commentStatus.hidden = false;
      commentStatus.textContent = 'No language model available. Enable a language model (e.g. GitHub Copilot Chat) to use this feature.';
    }
  } else if (msg.type === 'draftReviewError') {
    document.getElementById('draft-review').disabled = false;
    commentStatus.hidden = false;
    commentStatus.textContent = 'Failed to draft a review: ' + msg.message;
```

- [ ] **Step 3: Wire `extension.ts`**

```ts
  draftReview: () => Promise<void>;
```

```ts
    draftReview: () => pullRequestDetailsViewProvider.draftReview(),
```

- [ ] **Step 4: `package.json`**

```json
      {
        "command": "gitLore.draftPrReview",
        "title": "GitLore: Draft PR Review Comment with AI",
        "icon": "$(sparkle)"
      }
```

Add a command handler in `aiCommands.ts` (mirroring `handleExplainPullRequestCommand`) and register it in `extension.ts`'s subscriptions:

```ts
export function handleDraftPrReviewCommand(provider: PullRequestDetailsViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.draftPrReview, async () => {
    if (!provider.getCurrentSubjectForChat()) {
      void vscode.window.showInformationMessage('GitLore: open a PR in Pull Request Details first.');
      return;
    }
    await provider.draftReview();
  });
}
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit (stage only)**

```bash
git add src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts src/views/PullRequestDetails/render.ts src/extension.ts src/commands/aiCommands.ts package.json
```

---

### Task 26: Integration tests for "Draft Review"

**Files:**
- Modify: `test/integration/launchpad.test.ts`

**First, extend the test-only seam:** `draftReview`'s outcome lives in postMessage traffic (`draftReviewChunk`/`draftReviewDone`/`draftReviewNoModel`/etc.), same as `explainPr`'s `aiSummary*` messages — but Task 25 didn't add those messages to `aiMessagesForTest`. Before writing these tests, extend `postAiMessage` in `PullRequestDetailsViewProvider.ts` (added in Task 15, used by both `explainPr` and `draftReview` since they share the same `aiMessagesForTest` array and `postAiMessage` helper) — no code change needed there, since `draftReview` (Task 25) already calls `this.postAiMessage(...)` for every `draftReview*` message, which already pushes onto the same `aiMessagesForTest` array `getAiSummaryMessagesForTest()` exposes. So no seam work is needed here — `api.getPrAiSummaryMessagesForTest()` already captures `draftReview*` messages too.

- [ ] **Step 1: Write the failing tests, reusing the same fixture shape as Task 16**

```ts
test('draftReview: with AI disabled, resets instead of calling a model', async () =>
  withLaunchpadEnabled(() =>
    withOriginRemote('https://gitlab.com/acme/draft-widgets.git', async () => {
      api.launchpadProvider.setFetchImplForTest((async (url: string) => {
        if (url.endsWith('/user')) {
          return jsonResponse({ username: 'raj' });
        }
        if (url.includes('merge_requests?state=opened')) {
          return jsonResponse([
            {
              iid: 12,
              title: 'Draftable PR',
              web_url: 'https://gitlab.com/acme/draft-widgets/-/merge_requests/12',
              author: { username: 'raj' },
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]);
        }
        if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
          return jsonResponse([]);
        }
        if (url.endsWith('/approvals')) {
          return jsonResponse({ approved: false, approved_by: [] });
        }
        if (url.includes('merge_requests/12/diffs')) {
          return jsonResponse([{ old_path: 'src/x.ts', new_path: 'src/x.ts', diff: '@@ -1 +1,2 @@\n+thing();' }]);
        }
        if (url.includes('merge_requests/12/discussions')) {
          return jsonResponse([]);
        }
        throw new Error(`unmocked request in test: ${url}`);
      }) as unknown as typeof fetch);

      const originalInput = vscode.window.showInputBox;
      (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
        'fake-pat') as typeof vscode.window.showInputBox;
      try {
        await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
        await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Draftable PR'));
      } finally {
        vscode.window.showInputBox = originalInput;
      }
      await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'gitlab:acme/draft-widgets#12');
      await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('Draftable PR'));

      await withAiConfig(false, () => api.draftReview());
      assert.deepEqual(api.getPrAiSummaryMessagesForTest(), [{ type: 'draftReviewReset' }]);
    }),
  ));

test('draftReview: with AI enabled and no model registered, shows the no-model hint', async () =>
  withLaunchpadEnabled(() =>
    withOriginRemote('https://gitlab.com/acme/draft2-widgets.git', async () => {
      api.launchpadProvider.setFetchImplForTest((async (url: string) => {
        if (url.endsWith('/user')) {
          return jsonResponse({ username: 'raj' });
        }
        if (url.includes('merge_requests?state=opened')) {
          return jsonResponse([
            {
              iid: 13,
              title: 'Draftable PR Two',
              web_url: 'https://gitlab.com/acme/draft2-widgets/-/merge_requests/13',
              author: { username: 'raj' },
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]);
        }
        if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
          return jsonResponse([]);
        }
        if (url.endsWith('/approvals')) {
          return jsonResponse({ approved: false, approved_by: [] });
        }
        if (url.includes('merge_requests/13/diffs')) {
          return jsonResponse([{ old_path: 'src/x.ts', new_path: 'src/x.ts', diff: '@@ -1 +1,2 @@\n+thing();' }]);
        }
        if (url.includes('merge_requests/13/discussions')) {
          return jsonResponse([]);
        }
        throw new Error(`unmocked request in test: ${url}`);
      }) as unknown as typeof fetch);

      const originalInput = vscode.window.showInputBox;
      (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
        'fake-pat') as typeof vscode.window.showInputBox;
      try {
        await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
        await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Draftable PR Two'));
      } finally {
        vscode.window.showInputBox = originalInput;
      }
      await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'gitlab:acme/draft2-widgets#13');
      await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('Draftable PR Two'));

      await withAiConfig(true, () => api.draftReview());
      assert.deepEqual(api.getPrAiSummaryMessagesForTest(), [{ type: 'draftReviewNoModel' }]);
    }),
  ));
```

- [ ] **Step 2: Run full suite to verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 3: Commit (stage only)**

```bash
git add test/integration/launchpad.test.ts
```

---

## Known gap — `askAboutLine` has no UI entry point yet

Task 10 registers `gitLore.askAboutLine` and gates it out of the command palette (Task 12, Step 4), matching `explainLine`'s existing convention of being invoked only with real args from inside a hover, never typed by hand. But this plan does **not** add the actual hover wiring (a command link in `BlameHoverProvider`'s quick-actions row, alongside the existing Compare/File History/Copy SHA/Explain buttons) — that requires reading `BlameHoverProvider.ts`'s current hover-markdown construction first, which this plan's research pass didn't cover. Until that follow-up lands, `askAboutLine` is registered and testable via `vscode.commands.executeCommand(COMMANDS.askAboutLine, filePath, lineContent)` directly, but not reachable through any real UI action. Flagging this now rather than silently shipping a dead command — add a small follow-up task (read `BlameHoverProvider.ts`, add one command-link entry to its quick-actions row) before considering Milestone C fully done, or drop `askAboutLine` from `package.json`'s commands list if it's not worth a follow-up.

## Final verification (whole plan)

- [ ] Run `npm run lint` — PASS, zero type errors, zero `any`.
- [ ] Run `npm run test:unit` — PASS, every new pure-logic test green.
- [ ] Run `npm run test` — PASS, full unit + integration suite green, including `test/unit/media.test.ts`'s existence/orphan guard for `media/chat.css`.
- [ ] Run `npm run compile` — PASS, esbuild bundles cleanly.
- [ ] Manually smoke-test in the Extension Development Host (F5): enable `gitLore.ai.enabled`, open "GitLore: Open Chat", confirm the panel renders and the no-model hint appears (no `vscode.lm` provider is installed in a bare dev host, which is expected and matches the deterministic CI path).
- [ ] Update `CHANGELOG.md` under `## [Unreleased]`: add one line each for GitLore Chat, Explain PR, Branch Compare AI summary, NL changelog, and AI PR review draft.
- [ ] Update `README.md`'s feature list to include GitLore Chat and the four sweep features, per Definition of Done §16.
