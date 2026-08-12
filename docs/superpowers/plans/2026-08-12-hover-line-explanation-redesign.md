# Hover-Native Line Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the panel-based `gitLore.explainLine` (which opens Commit Details in the bottom panel) with a hover-native flow: clicking "Explain this line with AI" generates in the background with a status-bar spinner, and re-hovering the same line shows the finished explanation directly in that hover card — no panel navigation, ever.

**Architecture:** A new headless `LineExplanationService` reuses the existing, unchanged `runCommitSummaryFlow`/`LanguageModelClient`/`buildLineExplanationPrompt` and writes its outcome into a small shared `LruCache<string, LineExplanationState>`. `BlameHoverProvider` reads the same store on every hover. The panel-based line-explanation code from the prior plan is fully removed once the new path is built and verified — not left dormant.

**Tech Stack:** TypeScript (strict), the existing AI infrastructure (`vscode.lm`, `runCommitSummaryFlow`, `LruCache`), `vscode.window.withProgress` for background-task feedback, `node:test` for unit tests, `@vscode/test-electron` for integration tests.

## Global Constraints

- A `vscode.Hover` cannot be updated after it's returned — there is no live-streaming API for hovers. This is why the flow generates in the background and only shows results on the *next* hover, not why we chose to (a platform fact, not a design preference).
- `core/` has zero `vscode` imports. `LineExplanationState` and `buildLineExplanationKey` live in `core/ai/`, vscode-free.
- Never call a model unless `gitLore.ai.enabled` is `true` — unchanged gate, same config keys.
- `vscode.lm.sendRequest` may only run in response to a user action — the hover-link click remains that action.
- TypeScript strict, hard project rule: no `any` ever, no non-null `!` without inline justification (`@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-non-null-assertion` are `error`-level in `eslint.config.js`).
- No new runtime dependencies.
- The hover's `MarkdownString.isTrusted` stays scoped to `{ enabledCommands: [COMMANDS.explainLine] }`.
- Design doc: `docs/superpowers/specs/2026-08-12-hover-line-explanation-redesign-design.md`.
- Task ordering matters here specifically to avoid any transient broken build: Task 2 (hover rendering) must land before Task 3 (the service that writes to the store) so that `format.ts`'s new required parameter has exactly one real caller to update at each step; Task 4 (removing the old panel code) must land last, after nothing references it anymore.

---

## File Structure

**Create:**
- `src/core/ai/lineExplanationKey.ts` — `LineExplanationState` type + `buildLineExplanationKey` (pure).
- `src/ai/LineExplanationService.ts` — headless flow runner (vscode-facing, no unit test — see Task 3).
- `test/unit/core/ai/lineExplanationKey.test.ts`

**Modify:**
- `src/utils/format.ts` — `formatBlameHover` gains the state parameter and branches on it.
- `src/providers/BlameHoverProvider.ts` — resolves the key, reads the store, passes state through.
- `src/commands/aiCommands.ts` — `handleExplainLineCommand` rewritten around the new service.
- `src/extension.ts` — new store + service construction and wiring; later, removal of the now-dead `getCurrentLineContentForTest` seam.
- `src/views/CommitDetails/CommitDetailsViewProvider.ts` — reverted to its pre-line-explanation shape (Task 4).
- `src/views/CommitDetails/render.ts` — reverted `RenderCommitDetailsOptions`/AI section (Task 4).
- `test/unit/utils/format.test.ts`, `test/integration/hover.test.ts`, `test/unit/views/commitDetails.render.test.ts`, `test/integration/commitDetails.test.ts`.

---

### Task 1: `LineExplanationState` + `buildLineExplanationKey`

**Files:**
- Create: `src/core/ai/lineExplanationKey.ts`
- Test: `test/unit/core/ai/lineExplanationKey.test.ts`

**Interfaces:**
- Produces: `LineExplanationState` (`{status:'pending'} | {status:'done',text} | {status:'noModel'} | {status:'error',message}`) and `buildLineExplanationKey(repoRoot: string | null, filePath: string, sha: string, lineContent: string): string`, both imported by Task 2 (`format.ts`, `BlameHoverProvider.ts`, `extension.ts`) and Task 3 (`LineExplanationService.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/core/ai/lineExplanationKey.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineExplanationKey } from '../../../../src/core/ai/lineExplanationKey';

test('buildLineExplanationKey: uses repoRoot when available', () => {
  assert.equal(buildLineExplanationKey('/repo', '/repo/src/a.ts', 'abc123', 'line three'), '/repo:abc123:line three');
});

test('buildLineExplanationKey: falls back to filePath when repoRoot is null', () => {
  assert.equal(buildLineExplanationKey(null, '/repo/src/a.ts', 'abc123', 'line three'), '/repo/src/a.ts:abc123:line three');
});

test('buildLineExplanationKey: different line content produces different keys for the same commit', () => {
  const key1 = buildLineExplanationKey('/repo', '/repo/src/a.ts', 'abc123', 'line one');
  const key2 = buildLineExplanationKey('/repo', '/repo/src/a.ts', 'abc123', 'line two');
  assert.notEqual(key1, key2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/core/ai/lineExplanationKey.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/ai/lineExplanationKey.ts

/** The blame hover's line-explanation state, written by LineExplanationService and read by BlameHoverProvider on the next hover — a Hover can't be updated after it's returned, so this is how a background click's result reaches the UI. */
export type LineExplanationState =
  | { status: 'pending' }
  | { status: 'done'; text: string }
  | { status: 'noModel' }
  | { status: 'error'; message: string };

/** Both the writer (LineExplanationService) and the reader (BlameHoverProvider) must compute the exact same key from the same inputs for a background click's result to ever be seen by a later hover. Pure — no I/O, no vscode import. */
export function buildLineExplanationKey(repoRoot: string | null, filePath: string, sha: string, lineContent: string): string {
  return `${repoRoot ?? filePath}:${sha}:${lineContent}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/core/ai/lineExplanationKey.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/lineExplanationKey.ts test/unit/core/ai/lineExplanationKey.test.ts
git commit -m "feat(ai): add LineExplanationState type and its cache-key builder"
```

---

### Task 2: Hover rendering for `LineExplanationState`

**Files:**
- Modify: `src/utils/format.ts`
- Modify: `src/providers/BlameHoverProvider.ts`
- Modify: `src/extension.ts`
- Test: `test/unit/utils/format.test.ts`

**Interfaces:**
- Consumes: `LineExplanationState`, `buildLineExplanationKey` (Task 1).
- Produces: `formatBlameHover`'s new signature `(entry, diffStat, filePath, lineContent, lineExplanation: LineExplanationState | undefined, now?, issueLinking?)`. `BlameHoverProvider`'s new constructor `(source, git, lineExplanationStore: LruCache<string, LineExplanationState>)`. Task 3 constructs the real writer for this same store; until then, the store stays permanently empty and every hover renders the "never asked" link, identical to today's shipped behavior.

- [ ] **Step 1: Replace `test/unit/utils/format.test.ts` with its new content**

The signature is changing (new required parameter inserted before the existing optional ones) — every existing call needs updating, plus new tests for each state branch. Replace the whole file:

```typescript
// test/unit/utils/format.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlameHover } from '../../../src/utils/format';
import type { BlameLine, FileChange } from '../../../src/core/git/types';
import type { LineExplanationState } from '../../../src/core/ai/lineExplanationKey';

process.env.TZ = 'UTC';

const now = new Date('2024-02-04T10:00:00Z');

const entry: BlameLine = {
  line: 2,
  sha: '5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec',
  author: 'Amy Dev',
  authorEmail: 'amy@example.com',
  authorTime: Math.floor(new Date('2024-02-01T10:00:00Z').getTime() / 1000),
  summary: 'add line three',
  isUncommitted: false,
};

const diffStat: FileChange = { path: 'tracked.txt', insertions: 3, deletions: 1, binary: false };

test('formatBlameHover: includes gravatar, author, message, age, date, sha, and diff stat', () => {
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', undefined, now);
  assert.match(md, /!\[\]\(https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}\?s=20&d=identicon\)/);
  assert.match(md, /\*\*Amy Dev\*\*/);
  assert.match(md, /add line three/);
  assert.match(md, /3 days ago/);
  assert.match(md, /2024-02-01/);
  assert.match(md, /`5a93a8d`/);
  assert.match(md, /\+3 -1/);
});

test('formatBlameHover: omits the diff stat line when there is none', () => {
  const md = formatBlameHover(entry, null, 'tracked.txt', 'line three', undefined, now);
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: omits the diff stat line for binary files', () => {
  const md = formatBlameHover(
    entry,
    { path: 'image.png', insertions: 0, deletions: 0, binary: true },
    'image.png',
    'line three',
    undefined,
    now,
  );
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: uncommitted lines get a short fixed message, no gravatar, no AI link', () => {
  const md = formatBlameHover({ ...entry, isUncommitted: true }, null, 'tracked.txt', 'line three', undefined, now);
  assert.match(md, /Uncommitted changes/);
  assert.doesNotMatch(md, /gravatar\.com/);
  assert.ok(!md.includes('command:gitLore.explainLine'));
});

test('formatBlameHover: escapes markdown special characters from git-sourced fields', () => {
  const malicious: BlameLine = {
    ...entry,
    author: '[Evil](http://evil.com)',
    summary: 'click **here** or [here](http://evil.com)',
  };
  const md = formatBlameHover(malicious, null, 'tracked.txt', 'line three', undefined, now);
  assert.ok(!md.includes('[Evil](http://evil.com)'));
  assert.ok(!md.includes('[here](http://evil.com)'));
  assert.ok(!md.includes('**here**'));
  assert.ok(md.includes('\\[Evil\\]\\(http://evil\\.com\\)'));
});

test('formatBlameHover: links an issue reference in the message when issueLinking is provided', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, 'tracked.txt', 'line three', undefined, now, {
    pattern: '#(\\d+)',
    urlTemplate: 'https://github.com/o/r/issues/{issue}',
  });
  assert.ok(md.includes('[\\#12](https://github.com/o/r/issues/12)'));
});

test('formatBlameHover: without issueLinking, "#12" is left as escaped plain text, not a link', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, 'tracked.txt', 'line three', undefined, now);
  assert.ok(!md.includes('issues/12'));
  assert.ok(md.includes('\\#12'));
});

test('formatBlameHover: with no line-explanation state, shows the "Explain this line with AI" link', () => {
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', undefined, now);
  assert.match(md, /\[Explain this line with AI\]\(command:gitLore\.explainLine\?/);
  const match = /command:gitLore\.explainLine\?(\S+)\)/.exec(md);
  assert.ok(match, 'expected an encoded command link');
  const args = JSON.parse(decodeURIComponent(match[1] ?? '')) as unknown[];
  assert.deepEqual(args, ['tracked.txt', entry.sha, 'line three']);
});

test('formatBlameHover: pending state shows a generating notice, no link', () => {
  const state: LineExplanationState = { status: 'pending' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /Generating explanation/);
  assert.ok(!md.includes('command:gitLore.explainLine'));
});

test('formatBlameHover: done state shows the explanation text, no link', () => {
  const state: LineExplanationState = { status: 'done', text: 'This line guards against an unborn HEAD.' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /Why this line exists/);
  assert.match(md, /This line guards against an unborn HEAD\./);
  assert.ok(!md.includes('command:gitLore.explainLine'));
});

test('formatBlameHover: done state escapes markdown special characters in the model output', () => {
  const state: LineExplanationState = { status: 'done', text: 'Uses [a link](http://evil.com) and **bold**.' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.ok(!md.includes('[a link](http://evil.com)'));
  assert.ok(!md.includes('**bold**'));
});

test('formatBlameHover: noModel state shows the hint and a retry link', () => {
  const state: LineExplanationState = { status: 'noModel' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /No language model available/);
  assert.match(md, /\[Explain this line with AI\]\(command:gitLore\.explainLine\?/);
});

test('formatBlameHover: error state shows the message and a retry link', () => {
  const state: LineExplanationState = { status: 'error', message: 'network timeout' };
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', state, now);
  assert.match(md, /Failed to generate explanation: network timeout/);
  assert.match(md, /\[Explain this line with AI\]\(command:gitLore\.explainLine\?/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/utils/format.test.ts`
Expected: FAIL — `formatBlameHover` called with an extra argument in the wrong position / new-state assertions fail

- [ ] **Step 3: Replace `src/utils/format.ts` with its new content**

```typescript
// src/utils/format.ts
import type { BlameLine, FileChange } from '../core/git/types';
import { formatAge, formatAbsolute } from './date';
import { buildGravatarUrl } from './gravatar';
import { linkifyIssues, type IssueLinkOptions } from './issueLinks';
import { COMMANDS } from '../constants';
import type { LineExplanationState } from '../core/ai/lineExplanationKey';

const MARKDOWN_SPECIAL_RE = /([\\`*_{}[\]()#+\-.!|>~])/g;

/**
 * Escapes markdown syntax characters. `author` and `summary` come from git history, which
 * is attacker-influenced content if the repo isn't trusted — without this, a commit message
 * could inject fake links/emphasis/headings into the rendered hover.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL_RE, '\\$1');
}

/** Escapes `text` for markdown, linkifying any issue references per `issueLinking` first. */
function formatMessage(text: string, issueLinking: IssueLinkOptions | null): string {
  if (!issueLinking) {
    return escapeMarkdown(text);
  }
  return linkifyIssues(text, issueLinking.pattern, issueLinking.urlTemplate)
    .map((segment) => (segment.url ? `[${escapeMarkdown(segment.text)}](${segment.url})` : escapeMarkdown(segment.text)))
    .join('');
}

function buildExplainLineLink(filePath: string, sha: string, lineContent: string): string {
  const linkArgs = encodeURIComponent(JSON.stringify([filePath, sha, lineContent]));
  return `[Explain this line with AI](command:${COMMANDS.explainLine}?${linkArgs})`;
}

/**
 * Renders the line-explanation section of the hover based on its current state. A `Hover` can't
 * be updated after it's returned (no live-streaming API), so "in progress" and "finished" are
 * both just different static renders of whatever `formatBlameHover`'s caller looked up before
 * building this hover — see `LineExplanationService` for the writer side.
 */
function formatLineExplanation(
  state: LineExplanationState | undefined,
  filePath: string,
  sha: string,
  lineContent: string,
): string {
  if (state === undefined) {
    return buildExplainLineLink(filePath, sha, lineContent);
  }
  switch (state.status) {
    case 'pending':
      return '⏳ Generating explanation…';
    case 'done':
      return `**Why this line exists:**\n\n${escapeMarkdown(state.text)}`;
    case 'noModel':
      return `No language model available. Enable a language model (e.g. GitHub Copilot Chat) to use this feature.\n\n${buildExplainLineLink(filePath, sha, lineContent)}`;
    case 'error':
      return `Failed to generate explanation: ${escapeMarkdown(state.message)}\n\n${buildExplainLineLink(filePath, sha, lineContent)}`;
  }
}

/**
 * Builds the markdown body for the blame hover card. Pure — the caller wraps the result in
 * a `vscode.MarkdownString` and must set `isTrusted = { enabledCommands: [COMMANDS.explainLine] }`
 * for the "Explain this line with AI" link to actually be clickable — VS Code ignores command
 * links in untrusted markdown.
 */
export function formatBlameHover(
  entry: BlameLine,
  diffStat: FileChange | null,
  filePath: string,
  lineContent: string,
  lineExplanation: LineExplanationState | undefined,
  now: Date = new Date(),
  issueLinking: IssueLinkOptions | null = null,
): string {
  if (entry.isUncommitted) {
    return '**Uncommitted changes**\n\nThis line has not been committed yet.';
  }

  const date = new Date(entry.authorTime * 1000);
  const avatarUrl = buildGravatarUrl(entry.authorEmail, { size: 20 });
  const author = escapeMarkdown(entry.author);
  const message = formatMessage(entry.summary, issueLinking);
  const age = formatAge(date, now);
  const absoluteDate = formatAbsolute(date, 'yyyy-MM-dd HH:mm');
  const shortSha = entry.sha.slice(0, 7);

  const lines = [
    `![](${avatarUrl}) **${author}**`,
    '',
    message,
    '',
    `${age} · ${absoluteDate} · \`${shortSha}\``,
  ];

  if (diffStat && !diffStat.binary) {
    lines.push(`+${diffStat.insertions} -${diffStat.deletions}`);
  }

  lines.push('', formatLineExplanation(lineExplanation, filePath, entry.sha, lineContent));

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/utils/format.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Wire `BlameHoverProvider` to resolve and pass the state**

Replace `src/providers/BlameHoverProvider.ts` with:

```typescript
import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { BlameSource } from './BlameSource';
import { formatBlameHover } from '../utils/format';
import { resolveIssueLinking } from './issueLinking';
import { CONFIG, COMMANDS } from '../constants';
import { buildLineExplanationKey, type LineExplanationState } from '../core/ai/lineExplanationKey';
import type { LruCache } from '../core/cache/LruCache';

const DEFAULT_MAX_BLAME_FILE_SIZE = 1_048_576;

export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly source: BlameSource,
    private readonly git: GitService,
    private readonly lineExplanationStore: LruCache<string, LineExplanationState>,
  ) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    if (doc.uri.scheme !== 'file' || !this.getConfig<boolean>(CONFIG.blameEnabled, true)) {
      return undefined;
    }

    const maxSize = this.getConfig<number>(CONFIG.maxBlameFileSize, DEFAULT_MAX_BLAME_FILE_SIZE);
    if (Buffer.byteLength(doc.getText(), 'utf8') > maxSize) {
      return undefined;
    }

    try {
      const ignoreWhitespace = this.getConfig<boolean>(CONFIG.blameIgnoreWhitespace, true);
      const lines = await this.source.getBlameLines(doc.uri.fsPath, { ignoreWhitespace });
      const entry = lines?.find((l) => l.line === pos.line);
      if (!entry) {
        return undefined;
      }

      const diffStat = entry.isUncommitted ? null : await this.git.getFileDiffStat(doc.uri.fsPath, entry.sha);
      const issueLinking = await resolveIssueLinking(this.git, doc.uri.fsPath);
      const lineContent = doc.lineAt(pos.line).text.slice(0, 500);

      let lineExplanation: LineExplanationState | undefined;
      if (!entry.isUncommitted) {
        const repoRoot = await this.git.getRepoRoot(doc.uri.fsPath);
        const key = buildLineExplanationKey(repoRoot, doc.uri.fsPath, entry.sha, lineContent);
        lineExplanation = this.lineExplanationStore.get(key);
      }

      const markdown = new vscode.MarkdownString(
        formatBlameHover(entry, diffStat, doc.uri.fsPath, lineContent, lineExplanation, undefined, issueLinking),
      );
      markdown.isTrusted = { enabledCommands: [COMMANDS.explainLine] };
      return new vscode.Hover(markdown);
    } catch {
      // Blame failing on an unsaved/untracked file is expected — stay silent.
      return undefined;
    }
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
  }
}
```

- [ ] **Step 6: Wire the (still-empty) store in `extension.ts`**

Add the import, alongside the existing `LruCache` usage pattern (note: `extension.ts` doesn't currently import `LruCache` directly — this adds that import):

```typescript
import { LruCache } from './core/cache/LruCache';
import type { LineExplanationState } from './core/ai/lineExplanationKey';
```

Construct the store alongside `languageModelClient` (right after `const languageModelClient = new LanguageModelClient(logger);`):

```typescript
  const lineExplanationStore = new LruCache<string, LineExplanationState>(50);
```

Update the `BlameHoverProvider` construction line:

```typescript
  const hoverProvider = new BlameHoverProvider(blameSource, git, lineExplanationStore);
```

Nothing writes to this store yet — every hover still renders the "never asked" link, identical to today's shipped behavior. Task 3 adds the writer.

- [ ] **Step 7: Run the full suite**

Run: `npx tsc --noEmit -p .`
Run: `npm run lint`
Run: `npm run test:unit`
Run: `npm run test:integration`
Expected: all clean — the existing hover integration tests are unaffected (store is empty, so behavior is unchanged from what they already assert).

- [ ] **Step 8: Commit**

```bash
git add src/utils/format.ts src/providers/BlameHoverProvider.ts src/extension.ts test/unit/utils/format.test.ts
git commit -m "feat(ai): make the blame hover render LineExplanationState (store still unwritten)"
```

---

### Task 3: `LineExplanationService` + command rewiring

**Files:**
- Create: `src/ai/LineExplanationService.ts`
- Modify: `src/commands/aiCommands.ts`
- Modify: `src/extension.ts`
- Test: `test/integration/hover.test.ts`

**Interfaces:**
- Consumes: `LineExplanationState`, `buildLineExplanationKey` (Task 1); the `lineExplanationStore` constructed in Task 2's `extension.ts`; `runCommitSummaryFlow`, `buildLineExplanationPrompt`, `LanguageModelClient` (all pre-existing, unchanged).
- Produces: `LineExplanationService.explain(filePath, sha, lineContent, signal): Promise<void>` and `.getStateForTest(filePath, sha, lineContent): Promise<LineExplanationState | undefined>`.

- [ ] **Step 1: Create `LineExplanationService`**

```typescript
// src/ai/LineExplanationService.ts
import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { LanguageModelClient } from './LanguageModelClient';
import type { GitLogger } from '../core/git/errors';
import type { LruCache } from '../core/cache/LruCache';
import { runCommitSummaryFlow } from '../core/ai/commitSummaryFlow';
import { buildLineExplanationPrompt } from '../core/ai/prompts';
import { buildLineExplanationKey, type LineExplanationState } from '../core/ai/lineExplanationKey';
import { CONFIG } from '../constants';

/**
 * Runs "Explain This Line's History" headlessly — no webview, no panel. Writes its outcome into
 * a shared store that `BlameHoverProvider` reads on the next hover, since a native VS Code Hover
 * can't be updated after it's returned (there is no live-streaming API for hovers).
 */
export class LineExplanationService {
  constructor(
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
    private readonly store: LruCache<string, LineExplanationState>,
  ) {}

  /** Test-only introspection seam, same spirit as CommitDetailsViewProvider's getAiSummaryMessagesForTest(). */
  async getStateForTest(filePath: string, sha: string, lineContent: string): Promise<LineExplanationState | undefined> {
    const repoRoot = await this.git.getRepoRoot(filePath);
    return this.store.get(buildLineExplanationKey(repoRoot, filePath, sha, lineContent));
  }

  async explain(filePath: string, sha: string, lineContent: string, signal: AbortSignal): Promise<void> {
    const repoRoot = await this.git.getRepoRoot(filePath);
    const key = buildLineExplanationKey(repoRoot, filePath, sha, lineContent);

    const existing = this.store.get(key);
    if (existing?.status === 'pending') {
      return;
    }
    // Captured before the store is overwritten below — this is what lets a repeat request for an
    // already-answered line resolve via runCommitSummaryFlow's own 'cached' short-circuit instead
    // of re-calling the model.
    const cached = existing?.status === 'done' ? existing.text : undefined;
    this.store.set(key, { status: 'pending' });

    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const [commit, diff] = await Promise.all([this.git.getCommit(filePath, sha), this.git.getCommitDiff(filePath, sha)]);
    if (!commit) {
      this.store.delete(key);
      return;
    }

    const flow = runCommitSummaryFlow({
      enabled,
      cached,
      signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildLineExplanationPrompt(commit, diff, lineContent, maxDiffChars),
    });

    for await (const event of flow) {
      if (signal.aborted) {
        this.store.delete(key);
        return;
      }
      switch (event.type) {
        case 'disabled':
          void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG.section}.${CONFIG.aiEnabled}`);
            }
          });
          this.store.delete(key);
          break;
        case 'cached':
          // The store already holds the `done` state this came from — nothing to write.
          break;
        case 'chunk':
          // No live surface to update here — discarded. The full text arrives via 'done' below.
          break;
        case 'done':
          this.store.set(key, { status: 'done', text: event.text });
          break;
        case 'noModel':
          this.store.set(key, { status: 'noModel' });
          break;
        case 'error':
          this.logger.error('Line explanation failed', event.message);
          this.store.set(key, { status: 'error', message: event.message });
          break;
      }
    }
  }
}
```

- [ ] **Step 2: Rewrite `handleExplainLineCommand`**

Replace the full contents of `src/commands/aiCommands.ts`:

```typescript
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { CommitDetailsViewProvider } from '../views/CommitDetails/CommitDetailsViewProvider';
import type { LineExplanationService } from '../ai/LineExplanationService';

export function handleExplainCommitCommand(provider: CommitDetailsViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.explainCommit, async () => {
    if (!provider.hasLoadedCommit()) {
      void vscode.window.showInformationMessage('GitLore: open a commit in Commit Details first.');
      return;
    }
    await provider.explainCommit();
  });
}

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

- [ ] **Step 3: Wire the service in `extension.ts`**

Add the import:

```typescript
import { LineExplanationService } from './ai/LineExplanationService';
```

Construct it right after `lineExplanationStore` (from Task 2):

```typescript
  const lineExplanationService = new LineExplanationService(git, languageModelClient, logger, lineExplanationStore);
```

Change the `handleExplainLineCommand` call in `ctx.subscriptions.push(...)`:

```typescript
    handleExplainLineCommand(lineExplanationService),
```

Extend `GitLoreTestApi`:

```typescript
  getLineExplanationStateForTest: (filePath: string, sha: string, lineContent: string) => Promise<LineExplanationState | undefined>;
```

And the returned object:

```typescript
    getLineExplanationStateForTest: (filePath, sha, lineContent) =>
      lineExplanationService.getStateForTest(filePath, sha, lineContent),
```

(`CommitDetailsViewProvider`'s construction and `handleExplainCommitCommand` are untouched — the whole-commit summary panel flow is unaffected by this task.)

- [ ] **Step 4: Add the integration tests**

Add to `test/integration/hover.test.ts`, after the existing "offers a command link…" test. First add the config-toggle helper (same pattern as `commitDetails.test.ts`'s `withAiConfig`, redefined locally per this codebase's convention of self-contained test files):

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

  test('gitLore.explainLine with missing arguments shows an info message instead of throwing', async () => {
    await vscode.commands.executeCommand(COMMANDS.explainLine);
  });

  test('gitLore.explainLine with AI disabled shows the settings prompt and leaves the store empty', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);

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
      await withAiConfig(false, () =>
        Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
      );
    } finally {
      vscode.window.showInformationMessage = original;
    }

    assert.equal(calledWith, 'GitLore: AI features are disabled.');
    assert.equal(await api.getLineExplanationStateForTest(manifest.trackedFile, commit.sha, 'line three'), undefined);
  });

  test('gitLore.explainLine with AI enabled and no model registered stores noModel, and the next hover shows it', async () => {
    // The test host never has GitHub Copilot Chat (or any other vscode.lm provider) installed,
    // so this is the one "a real model is involved" branch that's actually deterministic in CI.
    const commit = manifest.commits[0];
    assert.ok(commit);

    await withAiConfig(true, () =>
      Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
    );

    assert.deepEqual(await api.getLineExplanationStateForTest(manifest.trackedFile, commit.sha, 'line three'), {
      status: 'noModel',
    });

    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(2, 0),
    );
    assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
    const text = hovers.map(hoverText).join('\n');
    assert.match(text, /No language model available/);
  });
```

- [ ] **Step 5: Run the full suite**

Run: `npx tsc --noEmit -p .`
Run: `npm run lint`
Run: `npm run test:unit`
Run: `npm run test:integration`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/ai/LineExplanationService.ts src/commands/aiCommands.ts src/extension.ts test/integration/hover.test.ts
git commit -m "feat(ai): generate line explanations in the background, surface them on re-hover"
```

---

### Task 4: Remove the panel-based line-explanation code

**Files:**
- Modify: `src/views/CommitDetails/CommitDetailsViewProvider.ts` (revert)
- Modify: `src/views/CommitDetails/render.ts` (revert)
- Modify: `src/extension.ts` (drop the now-dead test seam)
- Modify: `test/unit/views/commitDetails.render.test.ts` (remove 2 tests)
- Modify: `test/integration/commitDetails.test.ts` (remove 4 tests)

**Interfaces:**
- Nothing produced — this is pure removal. Everything Task 2/3 built is untouched; `CommitDetailsViewProvider.explainCommit()` and the panel's whole-commit-summary flow return to exactly their shape from before line explanations existed at all.

- [ ] **Step 1: Revert `CommitDetailsViewProvider.ts`**

Replace the full contents of `src/views/CommitDetails/CommitDetailsViewProvider.ts`:

```typescript
import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderCommitDetailsHtml, type RemoteTarget } from './render';
import { escapeHtml } from '../escapeHtml';
import { resolveIssueLinking } from '../../providers/issueLinking';
import { openFileDiff } from '../../providers/GitContentProvider';
import { buildCommitUrl, remoteHostLabel } from '../../utils/remoteLinks';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { LruCache } from '../../core/cache/LruCache';
import type { LanguageModelClient } from '../../ai/LanguageModelClient';
import type { GitLogger } from '../../core/git/errors';
import { runCommitSummaryFlow } from '../../core/ai/commitSummaryFlow';
import { buildCommitSummaryPrompt } from '../../core/ai/prompts';
import { COMMANDS, CONFIG, MEDIA, VIEWS } from '../../constants';
import type { CommitDetail } from '../../core/git/types';

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function shellHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none';" /></head><body>${bodyHtml}</body></html>`;
}

/** Docks commit details in the bottom panel (next to Commit Graph), matching GitLens's panel layout, instead of opening a new editor tab per commit. */
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

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  getCurrentHtmlForTest(): string | undefined {
    return this.view?.webview.html;
  }

  /** Test-only introspection seam, same spirit as `getCurrentHtmlForTest()` — the AI summary's state lives in postMessage traffic, not in the static webview HTML, so there's nothing else to assert against. */
  getAiSummaryMessagesForTest(): unknown[] {
    return this.aiMessagesForTest;
  }

  hasLoadedCommit(): boolean {
    return this.currentCommit !== undefined;
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
    // The view resolves the moment its tab is revealed, which is usually before any commit has
    // been picked. Say what to do instead of showing an empty rectangle.
    if (!this.currentCommit) {
      webviewView.webview.html = renderPlaceholderHtml('Select a commit in the Commit Graph to see its details.', {
        nonce: createNonce(),
        cspSource: webviewView.webview.cspSource,
        styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.commitDetails)],
      });
    }
  }

  /** Called by the "Show Commit Details" command — reveals the panel tab and loads the given commit. */
  async show(filePath: string, sha: string): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.commitDetails}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, sha);
  }

  private mediaUri(name: string): string {
    return this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  private async load(filePath: string, sha: string): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentFilePath = filePath;
    this.aiAbortController?.abort();
    this.aiMessagesForTest = [];
    this.view.title = `Commit ${sha.slice(0, 7)}`;
    this.view.webview.html = shellHtml('<p>Loading commit…</p>');

    try {
      const [commit, files, diff, issueLinking, remoteInfo] = await Promise.all([
        this.git.getCommit(filePath, sha),
        this.git.getCommitFiles(filePath, sha),
        this.git.getCommitDiff(filePath, sha),
        resolveIssueLinking(this.git, filePath),
        this.git.resolveRemoteInfo(filePath),
      ]);
      if (!commit) {
        this.view.webview.html = shellHtml('<p>GitLore: commit not found.</p>');
        return;
      }
      this.currentCommit = commit;
      this.currentDiff = diff;

      // Only offer "Open on <host>" when we know that host's commit-URL shape — a button that
      // reliably 404s is worse than no button.
      const url = remoteInfo ? buildCommitUrl(remoteInfo, commit.sha) : null;
      const remote: RemoteTarget | null = remoteInfo && url ? { label: remoteHostLabel(remoteInfo), url } : null;
      this.currentRemoteUrl = url ?? undefined;

      const editorFontFamily = vscode.workspace
        .getConfiguration('editor')
        .get<string>('fontFamily', 'Menlo, Monaco, monospace');

      this.view.webview.html = renderCommitDetailsHtml(
        { commit, files, diff },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.commitDetails)],
          editorFontFamily,
          issueLinking,
          remote,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitLore: failed to load commit — ${escapeHtml(message)}</p>`);
    }
  }

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

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, path } = message as { type?: unknown; path?: unknown };
    const commit = this.currentCommit;

    if (type === 'copySha' && commit) {
      await vscode.commands.executeCommand(COMMANDS.copySha, commit.sha);
      return;
    }
    if (type === 'copyMessage' && commit) {
      await vscode.env.clipboard.writeText(commit.body);
      void vscode.window.setStatusBarMessage('GitLore: commit message copied', 2000);
      return;
    }
    if (type === 'openRemote' && this.currentRemoteUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentRemoteUrl));
      return;
    }
    if (type === 'explainCommit') {
      await this.explainCommit();
      return;
    }
    if (type === 'openFileDiff' && typeof path === 'string' && commit && this.currentFilePath) {
      // `<sha>^` doesn't resolve for a root commit; GitService returns an empty left-hand side
      // for that, which is exactly right — every line reads as added.
      await openFileDiff({
        repoPath: this.currentFilePath,
        path,
        beforeRef: `${commit.sha}^`,
        afterRef: commit.sha,
        label: commit.shortSha,
      });
    }
  }
}
```

- [ ] **Step 2: Revert `render.ts`'s AI section**

In `src/views/CommitDetails/render.ts`, remove the `lineExplanation` field from `RenderCommitDetailsOptions`:

```typescript
export interface RenderCommitDetailsOptions {
  nonce: string;
  cspSource: string;
  /** Stylesheets to link, in order. Shared diff rules first, then the panel's own. */
  styleUris: string[];
  editorFontFamily: string;
  issueLinking?: IssueLinkOptions | null;
  remote?: RemoteTarget | null;
}
```

Replace the AI section block:

```html
<div class="section-head">
${AI_ICON}<span class="section-title">AI Summary</span>
</div>
<div class="ai-summary">
<button class="btn" id="explain-commit" type="button">${AI_ICON}Summarize with AI</button>
```

(The two `<p>` lines and closing `</div>` below it, and the entire `<script>` block, are untouched.)

- [ ] **Step 3: Drop the dead test seam from `extension.ts`**

Remove `getCurrentLineContentForTest` from the `GitLoreTestApi` interface and from the returned object. (`getLineExplanationStateForTest`, `lineExplanationService`, `lineExplanationStore`, and `handleExplainLineCommand(lineExplanationService)` from Tasks 2–3 all stay exactly as they are.)

- [ ] **Step 4: Remove the two obsolete render tests**

Delete these two tests from `test/unit/views/commitDetails.render.test.ts` (both are about the removed `lineExplanation` render option — the base "Summarize with AI" behavior they'd otherwise duplicate is already covered by the pre-existing `'renderCommitDetailsHtml: offers a Summarize with AI button that posts explainCommit'` test):

```typescript
test('renderCommitDetailsHtml: in line-explanation mode, shows a line-focused heading and a disabled, pre-labeled button', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, { ...opts, lineExplanation: true });
  assert.match(html, /Why does this line exist\?/);
  assert.match(html, /id="explain-commit" disabled type="button">.*?Explain this line<\/button>/s);
});

test('renderCommitDetailsHtml: without line-explanation mode, keeps the original heading, label, and enabled button', () => {
  const html = renderCommitDetailsHtml({ commit, files, diff, now }, opts);
  assert.match(html, /AI Summary/);
  assert.ok(!html.includes('Why does this line exist?'));
  assert.match(html, /id="explain-commit" type="button">.*?Summarize with AI<\/button>/s);
  assert.ok(!html.includes('id="explain-commit" disabled'));
});
```

- [ ] **Step 5: Remove the four obsolete integration tests**

Delete these four tests from `test/integration/commitDetails.test.ts` (all tied to the removed panel-based line-explanation path — the replacement coverage lives in Task 3's `hover.test.ts` additions):

```typescript
test('opening via a line explanation link auto-runs the flow with no extra command', async () => { ... });
test('gitLore.explainLine with missing arguments shows an info message instead of throwing', async () => { ... });
test('the panel shows the line-focused heading and a pre-disabled button when opened via explainLine', async () => { ... });
test('a re-click of the AI button after a line explanation re-runs the line flow, not a whole-commit summary', async () => { ... });
```

(Every other test in this file — base rendering, `explainCommit`'s disabled/no-model/cached paths — is untouched.)

- [ ] **Step 6: Run the full suite**

Run: `npx tsc --noEmit -p .`
Run: `npm run lint`
Run: `npm run test:unit`
Run: `npm run test:integration`
Expected: all clean. The panel's whole-commit-summary behavior should be indistinguishable from before line explanations ever existed; the new hover-native flow from Tasks 2–3 is unaffected since nothing here touches `format.ts`, `BlameHoverProvider.ts`, `LineExplanationService.ts`, or `aiCommands.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/views/CommitDetails/CommitDetailsViewProvider.ts src/views/CommitDetails/render.ts src/extension.ts test/unit/views/commitDetails.render.test.ts test/integration/commitDetails.test.ts
git commit -m "refactor(ai): remove the panel-based line-explanation path, now hover-native"
```

---

## Definition of Done (mirrors `CLAUDE.md` §16)

- [ ] Clicking the hover link never opens or focuses the Commit Details panel.
- [ ] Re-hovering the same line after generation completes shows the explanation in the hover card.
- [ ] `gitLore.ai.enabled` gate and the "user action only" rule hold for the new path exactly as they did for the old one.
- [ ] Cache/store keys never collide across different lines or different commits.
- [ ] The panel's whole-commit `gitLore.explainCommit` flow is behaviorally unchanged.
- [ ] No dead code left from the panel-based line-explanation path.
- [ ] Unit tests for `buildLineExplanationKey` and every `formatBlameHover` state branch; integration tests for the background-generate-then-rehover flow, the disabled gate, and the missing-arguments guard.
- [ ] `CHANGELOG.md` `## [Unreleased]` updated to describe the new hover behavior in place of the old panel-based description (manual step, not automated by this plan).
- [ ] `npm run lint` and `npm run test` pass clean.
