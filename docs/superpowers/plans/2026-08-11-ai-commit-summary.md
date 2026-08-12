# AI Commit Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `gitLore.explainCommit` — a button in the Commit Details panel that streams an AI-generated plain-English summary of the currently shown commit, using whatever model the user has registered with VS Code (never a stored key, never a hardcoded provider).

**Architecture:** A pure state machine (`runCommitSummaryFlow`) owns every branch of the summarize flow — disabled, cached, no-model, streaming, done, error, cancelled — driven entirely by injected fakes (`AbortSignal` instead of `vscode.CancellationToken`, a two-method `SummaryModel` interface instead of `vscode.LanguageModelChat`). This is what makes the whole flow unit-testable, including branches (a real model streaming, a real model erroring) that no CI host can ever reach for real, since there is no way to register a fake `vscode.lm` model in a test host. `LanguageModelClient` is the thin, untested-in-isolation adapter that bridges the pure flow to real `vscode.lm` calls — the same relationship `GitService` already has to `simple-git` in this codebase (a thin wrapper with no direct unit test, exercised only through the feature that uses it).

**Tech Stack:** TypeScript (strict), `vscode.lm` (VS Code's built-in Language Model API — no new dependency), existing `LruCache`, existing `GitLogger` interface, `node:test` for unit tests, `@vscode/test-electron` for integration tests.

## Global Constraints

- No new runtime dependencies. `vscode.lm` is built into the `vscode` module already used everywhere.
- Never call a model unless `gitLore.ai.enabled` is `true` — this is a privacy contract, not a UX nicety (spec, `CLAUDE.md` §11).
- `LanguageModelChat.sendRequest` "must _only be called in response to a user action_" per its own API doc — this is a hard platform requirement, not just our UX preference, so the summarize button must stay a manual click, never an auto-trigger on commit load.
- `core/` has zero `vscode` imports (`CLAUDE.md` §5). `runCommitSummaryFlow` and `buildCommitSummaryPrompt` use `AbortSignal`/plain types, not `vscode.CancellationToken`/`vscode.LanguageModelChat`, specifically to satisfy this.
- No new logger abstraction — reuse the existing `GitLogger` interface (`src/core/git/errors.ts`) and the single `GitLore` output channel already created in `extension.ts`.
- No engines.vscode bump. `vscode.lm` might not exist on older VS Code/Cursor builds still within the extension's declared `^1.85.0` floor; `LanguageModelClient.selectModel` checks `typeof vscode.lm === 'undefined'` and degrades to the same "no model" path rather than raising the minimum supported editor version for every GitLore user over one Phase 2 feature.
- Command titles and setting keys/defaults match `CLAUDE.md` §8 exactly: `gitLore.explainCommit` ("GitLore: Explain Commit with AI"), `gitLore.ai.enabled` (boolean, default `false`), `gitLore.ai.modelFamily` (string, default `"gpt-4o"`), `gitLore.ai.maxDiffChars` (number, default `8000`).
- Design doc: `docs/superpowers/specs/2026-08-11-ai-commit-summary-design.md`.

---

## File Structure

**Create:**
- `src/core/ai/prompts.ts` — pure `buildCommitSummaryPrompt`. Unit-tested.
- `src/core/ai/commitSummaryFlow.ts` — pure `runCommitSummaryFlow` state machine + its types. Unit-tested (this is where nearly all the logic and confidence live).
- `src/ai/LanguageModelClient.ts` — thin `vscode.lm` adapter. Integration-tested only, same as `GitService`.
- `src/commands/aiCommands.ts` — registers `gitLore.explainCommit`.

**Modify:**
- `src/constants.ts` — add `CONFIG.aiEnabled` / `aiModelFamily` / `aiMaxDiffChars`.
- `package.json` — add the three `gitLore.ai.*` settings and the `gitLore.explainCommit` command.
- `src/views/CommitDetails/render.ts` — add the "AI Summary" section + its inline script handlers.
- `media/commitDetails.css` — style the new section.
- `src/views/icons.ts` — add `AI_ICON`.
- `src/views/CommitDetails/CommitDetailsViewProvider.ts` — take `LanguageModelClient` + `GitLogger`, add `explainCommit()`, `hasLoadedCommit()`, the AI summary cache, cancellation, and a test-only posted-message seam.
- `src/extension.ts` — construct `LanguageModelClient`, wire it into `CommitDetailsViewProvider`, register `handleExplainCommitCommand`, extend `GitLoreTestApi`.
- `test/integration/commitDetails.test.ts` — add the AI summary integration tests.

---

### Task 1: `buildCommitSummaryPrompt`

**Files:**
- Create: `src/core/ai/prompts.ts`
- Test: `test/unit/core/ai/prompts.test.ts`

**Interfaces:**
- Produces: `buildCommitSummaryPrompt(commit: CommitDetail, diff: string, maxDiffChars: number): string`, imported from `../../../src/core/ai/prompts` by Task 4.

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/core/ai/prompts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommitSummaryPrompt } from '../../../../src/core/ai/prompts';
import type { CommitDetail } from '../../../../src/core/git/types';

const commit: CommitDetail = {
  sha: 'abc123',
  shortSha: 'abc123',
  author: 'Amy Dev',
  authorEmail: 'amy@example.com',
  date: '2024-02-01T10:00:00Z',
  message: 'fix: handle empty repo',
  body: 'fix: handle empty repo\n\nThis also fixes a crash when HEAD is unborn.',
};

test('buildCommitSummaryPrompt: includes the full commit body and the diff', () => {
  const diff = '+line three\n-line two\n';
  const prompt = buildCommitSummaryPrompt(commit, diff, 8000);
  assert.match(prompt, /This also fixes a crash when HEAD is unborn\./);
  assert.match(prompt, /\+line three/);
});

test('buildCommitSummaryPrompt: passes a diff under the limit through unchanged', () => {
  const diff = 'short diff';
  const prompt = buildCommitSummaryPrompt(commit, diff, 8000);
  assert.match(prompt, /short diff/);
  assert.ok(!prompt.includes('[...truncated]'));
});

test('buildCommitSummaryPrompt: truncates a diff over the limit and marks it', () => {
  const diff = 'a'.repeat(20);
  const prompt = buildCommitSummaryPrompt(commit, diff, 10);
  assert.match(prompt, /a{10}\[\.\.\.truncated\]/);
  assert.ok(!prompt.includes('a'.repeat(11)));
});

test('buildCommitSummaryPrompt: handles an empty diff (e.g. a merge commit)', () => {
  const prompt = buildCommitSummaryPrompt(commit, '', 8000);
  assert.match(prompt, /fix: handle empty repo/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/core/ai/prompts.test.ts`
Expected: FAIL — `Cannot find module '../../../../src/core/ai/prompts'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/ai/prompts.ts
import type { CommitDetail } from '../git/types';

const TRUNCATION_MARKER = '[...truncated]';

/** Builds the prompt for "Explain Commit with AI". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildCommitSummaryPrompt(commit: CommitDetail, diff: string, maxDiffChars: number): string {
  const body = diff.length > maxDiffChars ? diff.slice(0, maxDiffChars) + TRUNCATION_MARKER : diff;
  return `You are summarizing a single git commit for a developer skimming their repository's history.

Commit message:
${commit.body}

Diff:
${body}

Write a plain-English summary of what changed and why, in 2-4 sentences. Do not repeat the commit message verbatim. If the diff was truncated, base your summary only on what's shown.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/core/ai/prompts.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/prompts.ts test/unit/core/ai/prompts.test.ts
git commit -m "feat(ai): add commit summary prompt builder"
```

---

### Task 2: `runCommitSummaryFlow`

**Files:**
- Create: `src/core/ai/commitSummaryFlow.ts`
- Test: `test/unit/core/ai/commitSummaryFlow.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (takes `buildPrompt: () => string` as a parameter, so tests can fake it without importing `prompts.ts`).
- Produces, for Task 4:
  ```typescript
  interface SummaryModel {
    streamText(prompt: string, signal: AbortSignal): AsyncIterable<string>;
  }
  type SummaryEvent =
    | { type: 'disabled' }
    | { type: 'cached'; text: string }
    | { type: 'noModel' }
    | { type: 'chunk'; text: string }
    | { type: 'done'; text: string }
    | { type: 'error'; message: string };
  interface CommitSummaryFlowParams {
    enabled: boolean;
    cached: string | undefined;
    selectModel: () => Promise<SummaryModel | undefined>;
    buildPrompt: () => string;
    signal: AbortSignal;
  }
  function runCommitSummaryFlow(params: CommitSummaryFlowParams): AsyncGenerator<SummaryEvent>
  ```

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/core/ai/commitSummaryFlow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommitSummaryFlow, type SummaryEvent, type SummaryModel } from '../../../../src/core/ai/commitSummaryFlow';

async function collect(gen: AsyncGenerator<SummaryEvent>): Promise<SummaryEvent[]> {
  const events: SummaryEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function fakeModel(chunks: string[], failAfter?: number): SummaryModel {
  return {
    async *streamText() {
      for (let i = 0; i < chunks.length; i++) {
        if (failAfter !== undefined && i === failAfter) {
          throw new Error('model exploded');
        }
        yield chunks[i];
      }
    },
  };
}

test('runCommitSummaryFlow: disabled short-circuits before selecting a model', async () => {
  let selectCalls = 0;
  const events = await collect(
    runCommitSummaryFlow({
      enabled: false,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => {
        selectCalls++;
        return fakeModel(['x']);
      },
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'disabled' }]);
  assert.equal(selectCalls, 0);
});

test('runCommitSummaryFlow: a cache hit short-circuits before selecting a model', async () => {
  let selectCalls = 0;
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: 'previously generated summary',
      signal: new AbortController().signal,
      selectModel: async () => {
        selectCalls++;
        return fakeModel(['x']);
      },
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'cached', text: 'previously generated summary' }]);
  assert.equal(selectCalls, 0);
});

test('runCommitSummaryFlow: no model available yields noModel', async () => {
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => undefined,
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'noModel' }]);
});

test('runCommitSummaryFlow: streams chunks then yields done with the assembled text', async () => {
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => fakeModel(['Hello, ', 'world.']),
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'Hello, ' },
    { type: 'chunk', text: 'world.' },
    { type: 'done', text: 'Hello, world.' },
  ]);
});

test('runCommitSummaryFlow: a mid-stream failure yields the chunks seen so far, then error', async () => {
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => fakeModel(['partial '], 1),
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'partial ' },
    { type: 'error', message: 'model exploded' },
  ]);
});

test('runCommitSummaryFlow: aborting mid-stream ends the generator with no error event', async () => {
  const controller = new AbortController();
  const model: SummaryModel = {
    async *streamText(_prompt, signal) {
      yield 'first ';
      controller.abort();
      if (signal.aborted) {
        throw new Error('should not be surfaced');
      }
      yield 'second';
    },
  };
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: controller.signal,
      selectModel: async () => model,
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'chunk', text: 'first ' }]);
});

test('runCommitSummaryFlow: calls buildPrompt lazily, only once a model is found', async () => {
  let buildCalls = 0;
  await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => undefined,
      buildPrompt: () => {
        buildCalls++;
        return 'prompt';
      },
    }),
  );
  assert.equal(buildCalls, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/core/ai/commitSummaryFlow.test.ts`
Expected: FAIL — `Cannot find module '../../../../src/core/ai/commitSummaryFlow'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/ai/commitSummaryFlow.ts

/** A model bound to a prompt-streaming call. Deliberately not `vscode.LanguageModelChat` — this stays vscode-free so the whole flow is unit-testable. */
export interface SummaryModel {
  streamText(prompt: string, signal: AbortSignal): AsyncIterable<string>;
}

export type SummaryEvent =
  | { type: 'disabled' }
  | { type: 'cached'; text: string }
  | { type: 'noModel' }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface CommitSummaryFlowParams {
  enabled: boolean;
  cached: string | undefined;
  selectModel: () => Promise<SummaryModel | undefined>;
  buildPrompt: () => string;
  signal: AbortSignal;
}

/**
 * Pure orchestration for "Explain Commit with AI": disabled check -> cache check -> model
 * selection -> prompt build -> streaming -> done/error. `AbortSignal` and `SummaryModel` are
 * generic stand-ins for `vscode.CancellationToken`/`vscode.LanguageModelChat` specifically so
 * every branch here — including ones no real vscode.lm call in a test host can reach — is
 * unit-testable with fakes.
 */
export async function* runCommitSummaryFlow(params: CommitSummaryFlowParams): AsyncGenerator<SummaryEvent> {
  const { enabled, cached, selectModel, buildPrompt, signal } = params;

  if (!enabled) {
    yield { type: 'disabled' };
    return;
  }
  if (cached !== undefined) {
    yield { type: 'cached', text: cached };
    return;
  }

  const model = await selectModel();
  if (!model) {
    yield { type: 'noModel' };
    return;
  }

  const prompt = buildPrompt();
  let fullText = '';
  try {
    for await (const chunk of model.streamText(prompt, signal)) {
      if (signal.aborted) {
        return;
      }
      fullText += chunk;
      yield { type: 'chunk', text: chunk };
    }
  } catch (err) {
    if (signal.aborted) {
      return;
    }
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield { type: 'done', text: fullText };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/core/ai/commitSummaryFlow.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/commitSummaryFlow.ts test/unit/core/ai/commitSummaryFlow.test.ts
git commit -m "feat(ai): add pure commit-summary orchestration flow"
```

---

### Task 3: Settings, constants, and icon scaffolding

**Files:**
- Modify: `src/constants.ts`
- Modify: `package.json`
- Modify: `src/views/icons.ts`

**Interfaces:**
- Produces: `CONFIG.aiEnabled = 'ai.enabled'`, `CONFIG.aiModelFamily = 'ai.modelFamily'`, `CONFIG.aiMaxDiffChars = 'ai.maxDiffChars'` (Task 4 reads these), `AI_ICON: string` (Task 4's `render.ts` change uses this).

This task has no logic of its own to unit-test — it's pure declaration, consumed and exercised by Task 4's integration tests. Per the plan's task-sizing rule, this would normally fold into Task 4, but it's kept separate here because it's a distinct, mechanical, low-risk edit a reviewer can approve independently of the wiring logic.

- [ ] **Step 1: Add the config keys to `constants.ts`**

In `src/constants.ts`, extend the existing `CONFIG` object (do not create a second `CONFIG` — add these three lines inside the existing one, after `issueLinkingUrlTemplate`):

```typescript
  issueLinkingUrlTemplate: 'issueLinking.urlTemplate',
  aiEnabled: 'ai.enabled',
  aiModelFamily: 'ai.modelFamily',
  aiMaxDiffChars: 'ai.maxDiffChars',
} as const;
```

- [ ] **Step 2: Add the settings to `package.json`**

In `package.json`, inside `contributes.configuration.properties`, add after `"gitLore.issueLinking.urlTemplate"`'s closing brace:

```json
        ,
        "gitLore.ai.enabled": {
          "type": "boolean",
          "default": false,
          "description": "Enable AI features (commit summaries, line explanations). Uses your own language model via vscode.lm — no key or diff ever leaves your machine unless this is on."
        },
        "gitLore.ai.modelFamily": {
          "type": "string",
          "default": "gpt-4o",
          "description": "Preferred language model family hint (e.g. gpt-4o, claude-3.5-sonnet). Falls back to any available model if no match is found."
        },
        "gitLore.ai.maxDiffChars": {
          "type": "number",
          "default": 8000,
          "description": "Max diff size, in characters, sent to the model for a commit summary. Longer diffs are truncated."
        }
```

(Adjust the comma placement to valid JSON — this adds three properties after the existing last one.)

In `package.json`, inside `contributes.commands`, add after the `gitLore.compareBranches` entry:

```json
      {
        "command": "gitLore.explainCommit",
        "title": "GitLore: Explain Commit with AI",
        "icon": "$(sparkle)"
      }
```

- [ ] **Step 3: Add the AI icon**

In `src/views/icons.ts`, add after `CHECK_ICON`:

```typescript
/** Four-point sparkle — marks AI-generated content. */
export const AI_ICON = icon(
  '<path d="M8 2.2 9.1 6 12.9 7 9.1 8 8 11.8 6.9 8 3.1 7 6.9 6Z" /><path d="M12.5 2.4l0.5 1.3 1.3 0.5-1.3 0.5-0.5 1.3-0.5-1.3-1.3-0.5 1.3-0.5Z" />',
  'action-icon',
  12,
);
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit -p .`
Expected: no errors (nothing yet imports `AI_ICON` or the new `CONFIG` keys, so this only checks the edits themselves are syntactically valid TS/JSON).

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts package.json src/views/icons.ts
git commit -m "feat(ai): add gitLore.ai.* settings, explainCommit command, and AI icon"
```

---

### Task 4: `LanguageModelClient` + `CommitDetailsViewProvider` wiring

**Files:**
- Create: `src/ai/LanguageModelClient.ts`
- Create: `src/commands/aiCommands.ts`
- Modify: `src/views/CommitDetails/CommitDetailsViewProvider.ts`
- Modify: `src/extension.ts`
- Test: `test/integration/commitDetails.test.ts`

**Interfaces:**
- Consumes: `runCommitSummaryFlow`, `SummaryEvent`, `SummaryModel` (Task 2), `buildCommitSummaryPrompt` (Task 1), `CONFIG.aiEnabled`/`aiModelFamily`/`aiMaxDiffChars` (Task 3), `GitLogger` (`src/core/git/errors.ts`, existing), `LruCache` (`src/core/cache/LruCache.ts`, existing).
- Produces, for Task 5:
  - `CommitDetailsViewProvider.explainCommit(): Promise<void>` — runs the flow for the currently loaded commit and posts results to the webview.
  - `CommitDetailsViewProvider.hasLoadedCommit(): boolean`.
  - `CommitDetailsViewProvider` constructor becomes `(extensionUri: vscode.Uri, git: GitService, languageModelClient: LanguageModelClient, logger: GitLogger)`.
  - `GitLoreTestApi` gains `explainCommit: () => Promise<void>` and `getAiSummaryMessagesForTest: () => unknown[]`.

- [ ] **Step 1: Create `LanguageModelClient`**

```typescript
// src/ai/LanguageModelClient.ts
import * as vscode from 'vscode';
import type { SummaryModel } from '../core/ai/commitSummaryFlow';
import type { GitLogger } from '../core/git/errors';

/**
 * Thin adapter over `vscode.lm` — the only file that touches the Language Model API directly.
 * Not unit-tested in isolation: it does real I/O against whatever model the user has registered,
 * the same way `GitService` wraps `simple-git` without a unit test of its own. Its behavior is
 * exercised through `CommitDetailsViewProvider`'s integration tests, and the orchestration logic
 * around it is fully covered by `commitSummaryFlow.test.ts`.
 */
export class LanguageModelClient {
  constructor(private readonly logger: GitLogger) {}

  async selectModel(modelFamily: string): Promise<SummaryModel | undefined> {
    // vscode.lm doesn't exist on editor builds older than where the Language Model API landed —
    // GitLore's declared engines.vscode floor predates it, so this checks rather than assumes.
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
      streamText: (prompt, signal) => this.streamText(model, prompt, signal),
    };
  }

  private async *streamText(model: vscode.LanguageModelChat, prompt: string, signal: AbortSignal): AsyncIterable<string> {
    const tokenSource = new vscode.CancellationTokenSource();
    const onAbort = () => tokenSource.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, tokenSource.token);
      for await (const chunk of response.text) {
        yield chunk;
      }
    } catch (err) {
      this.logger.error('AI commit summary request failed', err);
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
      tokenSource.dispose();
    }
  }
}
```

- [ ] **Step 2: Wire it into `CommitDetailsViewProvider`**

In `src/views/CommitDetails/CommitDetailsViewProvider.ts`, update the imports and class as follows.

Add to the imports at the top:

```typescript
import { LruCache } from '../../core/cache/LruCache';
import type { LanguageModelClient } from '../../ai/LanguageModelClient';
import type { GitLogger } from '../../core/git/errors';
import { runCommitSummaryFlow } from '../../core/ai/commitSummaryFlow';
import { buildCommitSummaryPrompt } from '../../core/ai/prompts';
import { COMMANDS, CONFIG, MEDIA, VIEWS } from '../../constants';
```

(this replaces the existing `import { COMMANDS, MEDIA, VIEWS } from '../../constants';` line — add `CONFIG` to it.)

Replace the class's field declarations and constructor:

```typescript
export class CommitDetailsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;
  private currentCommit: CommitDetail | undefined;
  private currentRemoteUrl: string | undefined;
  private currentDiff: string | undefined;
  private aiSummaryCache = new LruCache<string, string>(50);
  private aiAbortController: AbortController | undefined;
  private aiMessagesForTest: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  /** Test-only introspection seam, same spirit as `getCurrentHtmlForTest()` — the AI summary's state lives in postMessage traffic, not in the static webview HTML, so there's nothing else to assert against. */
  getAiSummaryMessagesForTest(): unknown[] {
    return this.aiMessagesForTest;
  }

  hasLoadedCommit(): boolean {
    return this.currentCommit !== undefined;
  }
```

In the `load()` method, store the diff and cancel any in-flight summary from a previous commit — add these two lines right after `this.currentFilePath = filePath;`:

```typescript
    this.currentFilePath = filePath;
    this.aiAbortController?.abort();
    this.aiMessagesForTest = [];
```

And where `this.currentCommit = commit;` is set, also store the diff (`diff` is already destructured from the `Promise.all` result a few lines above it):

```typescript
      this.currentCommit = commit;
      this.currentDiff = diff;
```

Add the `explainCommit` method and its helper, anywhere after `load()`:

```typescript
  async explainCommit(): Promise<void> {
    if (!this.view || !this.currentCommit || !this.currentFilePath) {
      return;
    }
    this.aiAbortController?.abort();
    const controller = new AbortController();
    this.aiAbortController = controller;

    const commit = this.currentCommit;
    const diff = this.currentDiff ?? '';
    const filePath = this.currentFilePath;
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const repoRoot = await this.git.getRepoRoot(filePath);
    const cacheKey = `${repoRoot ?? filePath}:${commit.sha}`;
    const cached = this.aiSummaryCache.get(cacheKey);

    const flow = runCommitSummaryFlow({
      enabled,
      cached,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildCommitSummaryPrompt(commit, diff, maxDiffChars),
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
          this.logger.error('AI commit summary failed', event.message);
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

Finally, in `handleMessage`, add a case for the webview's button click (add this alongside the existing `if (type === 'copySha' ...)` etc. blocks):

```typescript
    if (type === 'explainCommit') {
      await this.explainCommit();
      return;
    }
```

- [ ] **Step 3: Wire `LanguageModelClient` into `extension.ts`**

In `src/extension.ts`, add the import:

```typescript
import { LanguageModelClient } from './ai/LanguageModelClient';
import { handleExplainCommitCommand } from './commands/aiCommands';
```

Construct it alongside `git` (right after `const git = new GitService(logger);`):

```typescript
  const languageModelClient = new LanguageModelClient(logger);
```

Update the `CommitDetailsViewProvider` construction line to pass the two new arguments:

```typescript
  const commitDetailsViewProvider = new CommitDetailsViewProvider(ctx.extensionUri, git, languageModelClient, logger);
```

Register the command — add to the `ctx.subscriptions.push(...)` list, alongside `handleCompareBranchesCommand(...)`:

```typescript
    handleExplainCommitCommand(commitDetailsViewProvider),
```

Create `src/commands/aiCommands.ts` now, in full — Task 5 only adds the webview button that triggers the same `provider.explainCommit()` path, so there's nothing left to change here later:

```typescript
// src/commands/aiCommands.ts
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { CommitDetailsViewProvider } from '../views/CommitDetails/CommitDetailsViewProvider';

export function handleExplainCommitCommand(provider: CommitDetailsViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.explainCommit, async () => {
    if (!provider.hasLoadedCommit()) {
      void vscode.window.showInformationMessage('GitLore: open a commit in Commit Details first.');
      return;
    }
    await provider.explainCommit();
  });
}
```

Extend `GitLoreTestApi` and the returned object:

```typescript
export interface GitLoreTestApi {
  blameProvider: BlameDecorationProvider;
  fileHistoryProvider: FileHistoryProvider;
  statusBarProvider: StatusBarProvider;
  git: GitService;
  getCommitDetailsHtml: () => string | undefined;
  getCommitGraphHtml: () => string | undefined;
  getBranchComparisonHtml: () => string | undefined;
  explainCommit: () => Promise<void>;
  getAiSummaryMessagesForTest: () => unknown[];
}
```

```typescript
  return {
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    git,
    getCommitDetailsHtml: () => commitDetailsViewProvider.getCurrentHtmlForTest(),
    getCommitGraphHtml: () => commitGraphViewProvider.getCurrentHtmlForTest(),
    getBranchComparisonHtml: () => branchComparisonViewProvider.getCurrentHtmlForTest(),
    explainCommit: () => commitDetailsViewProvider.explainCommit(),
    getAiSummaryMessagesForTest: () => commitDetailsViewProvider.getAiSummaryMessagesForTest(),
  };
```

- [ ] **Step 4: Write the integration tests**

Add to `test/integration/commitDetails.test.ts`, inside the existing `suite('Commit details webview', ...)` block (after the last existing `test(...)`):

```typescript
  async function withAiConfig<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('ai.enabled', enabled, vscode.ConfigurationTarget.Global);
    try {
      return await fn();
    } finally {
      await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  }

  test('explainCommit prompts to enable AI when gitLore.ai.enabled is false', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    const original = vscode.window.showInformationMessage;
    let calledWith: string | undefined;
    (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
      message: string,
      ..._rest: unknown[]
    ) => {
      calledWith = message;
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showInformationMessage;

    try {
      await withAiConfig(false, () => api.explainCommit());
    } finally {
      vscode.window.showInformationMessage = original;
    }

    assert.equal(calledWith, 'GitLore: AI features are disabled.');
    assert.deepEqual(api.getAiSummaryMessagesForTest(), [{ type: 'aiSummaryReset' }]);
  });

  test('explainCommit shows the no-model hint when AI is enabled but no language model is registered', async () => {
    // The test host never has GitHub Copilot Chat (or any other vscode.lm provider) installed,
    // so vscode.lm.selectChatModels() reliably resolves to an empty list here — this is the one
    // "a real model is involved" branch that's actually deterministic in CI.
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    await withAiConfig(true, () => api.explainCommit());

    assert.deepEqual(api.getAiSummaryMessagesForTest(), [{ type: 'aiSummaryNoModel' }]);
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit -p .` (must compile clean first)
Run: `npm run test:integration`
Expected: all existing `commitDetails.test.ts` tests still pass, plus the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/ai/LanguageModelClient.ts src/commands/aiCommands.ts src/views/CommitDetails/CommitDetailsViewProvider.ts src/extension.ts test/integration/commitDetails.test.ts
git commit -m "feat(ai): wire vscode.lm client into Commit Details, add explainCommit"
```

---

### Task 5: Webview button + AI Summary section

**Files:**
- Modify: `src/views/CommitDetails/render.ts`
- Modify: `media/commitDetails.css`
- Test: `test/unit/views/commitDetails.render.test.ts`
- Test: `test/integration/commitDetails.test.ts`

**Interfaces:**
- Consumes: `AI_ICON` (Task 3), `CommitDetailsViewProvider.explainCommit()` / `hasLoadedCommit()` and the `gitLore.explainCommit` command (Task 4, already fully wired — this task only adds the webview-side trigger for it).
- Produces: nothing further downstream — this is the last task in the plan.

- [ ] **Step 1: Write the failing render tests**

Add to `test/unit/views/commitDetails.render.test.ts`, after the last existing `test(...)`:

```typescript
test('renderCommitDetailsHtml: offers a Summarize with AI button that posts explainCommit', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /id="explain-commit" type="button">.*?Summarize with AI<\/button>/s);
  assert.match(html, /type: 'explainCommit'/);
});

test('renderCommitDetailsHtml: the AI summary text and hint start hidden', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /id="ai-summary-text"[^>]*hidden/);
  assert.match(html, /id="ai-summary-hint"[^>]*hidden/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/views/commitDetails.render.test.ts`
Expected: FAIL — no `id="explain-commit"` in the rendered HTML.

- [ ] **Step 3: Add the AI Summary section to `render.ts`**

In `src/views/CommitDetails/render.ts`, add `AI_ICON` to the existing icons import:

```typescript
import { AI_ICON, COPY_ICON, EXTERNAL_ICON, FILES_ICON, MESSAGE_ICON, SEARCH_ICON, WRAP_ICON } from '../icons';
```

Add a new section between the `commit-body` block and the "Files changed" `section-head` block in `renderCommitDetailsHtml`'s returned template (insert right before the line `<div class="section-head">\n${FILES_ICON}...`):

```html
<div class="section-head">
${AI_ICON}<span class="section-title">AI Summary</span>
</div>
<div class="ai-summary">
<button class="btn" id="explain-commit" type="button">${AI_ICON}Summarize with AI</button>
<p class="ai-summary-text" id="ai-summary-text" hidden></p>
<p class="ai-summary-hint" id="ai-summary-hint" hidden></p>
</div>
```

Add the button's click handler and the incoming-message listener to the `<script>` block, right after the existing `remoteBtn` handler:

```javascript
const explainBtn = document.getElementById('explain-commit');
const summaryText = document.getElementById('ai-summary-text');
const summaryHint = document.getElementById('ai-summary-hint');
explainBtn.addEventListener('click', () => {
  explainBtn.disabled = true;
  summaryHint.hidden = true;
  summaryText.hidden = false;
  summaryText.textContent = '';
  vscode.postMessage({ type: 'explainCommit' });
});
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'aiSummaryChunk') {
    summaryText.textContent += msg.text;
  } else if (msg.type === 'aiSummaryCached') {
    summaryText.hidden = false;
    summaryText.textContent = msg.text;
    explainBtn.disabled = false;
  } else if (msg.type === 'aiSummaryDone' || msg.type === 'aiSummaryReset') {
    explainBtn.disabled = false;
  } else if (msg.type === 'aiSummaryNoModel') {
    summaryText.hidden = true;
    summaryHint.hidden = false;
    summaryHint.textContent = 'No language model available. Enable a language model (e.g. GitHub Copilot Chat) to use this feature.';
    explainBtn.disabled = false;
  } else if (msg.type === 'aiSummaryError') {
    summaryText.hidden = true;
    summaryHint.hidden = false;
    summaryHint.textContent = 'Failed to generate summary: ' + msg.message;
    explainBtn.disabled = false;
  }
});
```

(All AI summary text is set via `textContent`, never `innerHTML` — safe from injection by construction, no server-side escaping needed for this section.)

- [ ] **Step 4: Style the new section**

Add to the end of `media/commitDetails.css`:

```css
/* ---------- AI summary ---------- */

.ai-summary {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
}

.ai-summary-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0.5rem 0 0;
  font-size: 0.95em;
}

.ai-summary-hint {
  opacity: 0.65;
  margin: 0.5rem 0 0;
  font-size: 0.92em;
}
```

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `npx tsx --test test/unit/views/commitDetails.render.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 6: Write and run the integration test for the command wiring**

Add to `test/integration/commitDetails.test.ts`, after the tests added in Task 4:

```typescript
  test('the AI Summary section and button are present in the rendered panel', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    const html = api.getCommitDetailsHtml() ?? '';
    assert.match(html, /id="explain-commit"/);
    assert.match(html, /AI Summary/);
  });

  test('gitLore.explainCommit command drives the same flow as the panel button', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);
    await vscode.commands.executeCommand(COMMANDS.showCommit, manifest.trackedFile, commit.sha);
    await waitFor(() => (api.getCommitDetailsHtml() ?? '').includes(commit.sha));

    await withAiConfig(true, () => vscode.commands.executeCommand(COMMANDS.explainCommit));

    assert.deepEqual(api.getAiSummaryMessagesForTest(), [{ type: 'aiSummaryNoModel' }]);
  });
```

Run: `npm run compile && npm run test:integration`
Expected: all `commitDetails.test.ts` tests pass.

- [ ] **Step 7: Full check**

Run: `npm run lint`
Expected: clean (no ESLint errors, `tsc --noEmit` clean).

- [ ] **Step 8: Commit**

```bash
git add src/views/CommitDetails/render.ts media/commitDetails.css test/unit/views/commitDetails.render.test.ts test/integration/commitDetails.test.ts
git commit -m "feat(ai): add Summarize with AI button and summary section to Commit Details"
```

---

## Definition of Done (mirrors `CLAUDE.md` §16)

- [ ] Works with `gitLore.ai.enabled` false (default), true with no model, and — manually, since no CI host has one — true with a real model installed.
- [ ] `gitLore.ai.enabled`, `gitLore.ai.modelFamily`, `gitLore.ai.maxDiffChars` all respected.
- [ ] No new `context.subscriptions` leak — `handleExplainCommitCommand` is pushed alongside the other command registrations.
- [ ] Errors handled per §13: disabled → prompt, no model → inline hint, request failure → inline error + output-channel log, cancellation → silent.
- [ ] Unit tests for `prompts.ts` and `commitSummaryFlow.ts`; integration tests for the wiring and the UI.
- [ ] `CHANGELOG.md` `## [Unreleased]` updated with the new feature (not automated by this plan — add manually before release).
- [ ] `npm run lint` and `npm run test` pass clean.
