# AI Line Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `gitLore.explainLine` — a command link in the blame hover ("Explain this line with AI") that opens Commit Details for the line's blamed commit and automatically streams an explanation focused on that line, reusing the AI infrastructure built for `gitLore.explainCommit`.

**Architecture:** `runCommitSummaryFlow` (the pure state machine from the commit-summary feature) is reused completely unchanged — only a new prompt builder and a generalized cache key differ. `CommitDetailsViewProvider`'s existing AI-flow logic is factored into one shared private method that both `explainCommit()` and the new `explainLine()` call, so the two features can never drift apart in error handling, cancellation, or caching behavior.

**Tech Stack:** TypeScript (strict), `vscode.lm`, the existing `LruCache`/`GitLogger`/`LanguageModelClient` from the commit-summary feature, `node:test` for unit tests, `@vscode/test-electron` for integration tests.

## Global Constraints

- No new runtime dependencies, no new `gitLore.ai.*` settings — this feature reads the existing `ai.enabled` / `ai.modelFamily` / `ai.maxDiffChars` keys.
- Never call a model unless `gitLore.ai.enabled` is `true`.
- `vscode.lm.sendRequest` may only run in response to a user action. The hover-link click is that action — `explainLine()` auto-running immediately after the panel loads (no second click) is compliant because the click already happened; it does not mean the flow is ever triggered without one.
- `core/` has zero `vscode` imports — `buildLineExplanationPrompt` follows `buildCommitSummaryPrompt`'s existing pattern exactly.
- Scope is the blamed commit only, not the line's full multi-commit history (no `git log -L`, no new git plumbing) — the line's *current* literal text is passed to the model so it can find itself inside the single commit's diff, avoiding any line-number correlation across commits.
- The hover's `MarkdownString.isTrusted` must be scoped to `{ enabledCommands: [COMMANDS.explainLine] }`, never blanket `true`.
- Command titles match `CLAUDE.md` §8 exactly: `gitLore.explainLine` — "GitLore: Explain This Line's History".
- Design doc: `docs/superpowers/specs/2026-08-12-ai-line-explanation-design.md`.

---

## File Structure

**Modify:**
- `src/core/ai/prompts.ts` — add `buildLineExplanationPrompt`.
- `src/utils/format.ts` — `formatBlameHover` gains the command link.
- `src/providers/BlameHoverProvider.ts` — passes the new args, sets scoped `isTrusted`.
- `src/views/CommitDetails/CommitDetailsViewProvider.ts` — factor `explainCommit()` into a shared `runAiFlow`, add `explainLine()`, extend `show()`/`load()` to auto-run.
- `src/commands/aiCommands.ts` — add `handleExplainLineCommand`.
- `src/extension.ts` — wire the new command.
- `src/views/CommitDetails/render.ts` — adaptive AI-section heading/button/initial state.
- `package.json` — add the `gitLore.explainLine` command (hidden from the command palette, like `copySha`).
- `test/unit/contributions.test.ts` — drop `explainLine` from the reserved set.
- `test/unit/utils/format.test.ts`, `test/integration/hover.test.ts`, `test/unit/views/commitDetails.render.test.ts`, `test/integration/commitDetails.test.ts` — updated/new tests.

**Create:**
- `test/unit/core/ai/lineExplanationPrompt.test.ts`

---

### Task 1: `buildLineExplanationPrompt`

**Files:**
- Modify: `src/core/ai/prompts.ts`
- Test: `test/unit/core/ai/lineExplanationPrompt.test.ts`

**Interfaces:**
- Produces: `buildLineExplanationPrompt(commit: CommitDetail, diff: string, lineContent: string, maxDiffChars: number): string`, imported by Task 4's `CommitDetailsViewProvider`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/core/ai/lineExplanationPrompt.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineExplanationPrompt } from '../../../../src/core/ai/prompts';
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

test('buildLineExplanationPrompt: includes the line content, commit body, and diff', () => {
  const prompt = buildLineExplanationPrompt(commit, '+line three\n-line two\n', 'line three', 8000);
  assert.match(prompt, /line three/);
  assert.match(prompt, /This also fixes a crash when HEAD is unborn\./);
  assert.match(prompt, /\+line three/);
});

test('buildLineExplanationPrompt: passes a diff under the limit through unchanged', () => {
  const prompt = buildLineExplanationPrompt(commit, 'short diff', 'x', 8000);
  assert.match(prompt, /short diff/);
  assert.ok(!prompt.includes('[...truncated]'));
});

test('buildLineExplanationPrompt: truncates a diff over the limit and marks it', () => {
  const diff = 'a'.repeat(20);
  const prompt = buildLineExplanationPrompt(commit, diff, 'x', 10);
  assert.match(prompt, /a{10}\[\.\.\.truncated\]/);
  assert.ok(!prompt.includes('a'.repeat(11)));
});

test('buildLineExplanationPrompt: handles an empty diff', () => {
  const prompt = buildLineExplanationPrompt(commit, '', 'line three', 8000);
  assert.match(prompt, /fix: handle empty repo/);
  assert.match(prompt, /line three/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/core/ai/lineExplanationPrompt.test.ts`
Expected: FAIL — `buildLineExplanationPrompt is not exported` / not a function

- [ ] **Step 3: Write minimal implementation**

Add to `src/core/ai/prompts.ts`, after the existing `buildCommitSummaryPrompt` (reuses the same `TRUNCATION_MARKER` constant already defined at the top of the file):

```typescript
/** Builds the prompt for "Explain This Line's History". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildLineExplanationPrompt(commit: CommitDetail, diff: string, lineContent: string, maxDiffChars: number): string {
  const body = diff.length > maxDiffChars ? diff.slice(0, maxDiffChars) + TRUNCATION_MARKER : diff;
  return `You are explaining why a specific line of code exists, to a developer reading it in their editor.

The line in question:
${lineContent}

It was last changed in this commit. Commit message:
${commit.body}

Diff:
${body}

Find the line above within the diff and explain why it was introduced or changed, in 2-4 sentences. Do not repeat the commit message verbatim. If the diff was truncated and the line isn't visible in what's shown, say so instead of guessing.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/core/ai/lineExplanationPrompt.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/prompts.ts test/unit/core/ai/lineExplanationPrompt.test.ts
git commit -m "feat(ai): add line explanation prompt builder"
```

---

### Task 2: Hover command link

**Files:**
- Modify: `src/utils/format.ts`
- Modify: `src/providers/BlameHoverProvider.ts`
- Test: `test/unit/utils/format.test.ts`
- Test: `test/integration/hover.test.ts`

**Interfaces:**
- Consumes: `COMMANDS.explainLine` (`src/constants.ts`, already defined).
- Produces: `formatBlameHover`'s new signature `formatBlameHover(entry: BlameLine, diffStat: FileChange | null, filePath: string, lineContent: string, now?: Date, issueLinking?: IssueLinkOptions | null): string` — Task 4 does not call this function, but must know it now requires `filePath`/`lineContent` if it ever needs to (it doesn't).

- [ ] **Step 1: Update the failing/changed tests in `format.test.ts`**

`formatBlameHover` is changing its parameter list (`filePath` and `lineContent` inserted after `diffStat`, before the existing optional `now`/`issueLinking`). Every existing call in this file needs the two new arguments, and two new tests are added for the link itself. Replace the whole file with:

```typescript
// test/unit/utils/format.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlameHover } from '../../../src/utils/format';
import type { BlameLine, FileChange } from '../../../src/core/git/types';

// formatBlameHover renders the absolute date in the local calendar; pin TZ for determinism.
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
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', now);
  assert.match(md, /!\[\]\(https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}\?s=64&d=identicon\)/);
  assert.match(md, /\*\*Amy Dev\*\*/);
  assert.match(md, /add line three/);
  assert.match(md, /3 days ago/);
  assert.match(md, /2024-02-01/);
  assert.match(md, /`5a93a8d`/);
  assert.match(md, /\+3 -1/);
});

test('formatBlameHover: omits the diff stat line when there is none', () => {
  const md = formatBlameHover(entry, null, 'tracked.txt', 'line three', now);
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: omits the diff stat line for binary files', () => {
  const md = formatBlameHover(entry, { path: 'image.png', insertions: 0, deletions: 0, binary: true }, 'image.png', 'line three', now);
  assert.doesNotMatch(md, /\+\d+ -\d+/);
});

test('formatBlameHover: uncommitted lines get a short fixed message, no gravatar, no AI link', () => {
  const md = formatBlameHover({ ...entry, isUncommitted: true }, null, 'tracked.txt', 'line three', now);
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
  const md = formatBlameHover(malicious, null, 'tracked.txt', 'line three', now);
  // The raw unescaped forms must not appear — they'd render as a live link/emphasis.
  assert.ok(!md.includes('[Evil](http://evil.com)'));
  assert.ok(!md.includes('[here](http://evil.com)'));
  assert.ok(!md.includes('**here**'));
  // The escaped form (a literal backslash before every markdown special char) must appear instead.
  assert.ok(md.includes('\\[Evil\\]\\(http://evil\\.com\\)'));
});

test('formatBlameHover: links an issue reference in the message when issueLinking is provided', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, 'tracked.txt', 'line three', now, {
    pattern: '#(\\d+)',
    urlTemplate: 'https://github.com/o/r/issues/{issue}',
  });
  // The link text is itself markdown-escaped (consistent with the rest of the message), so
  // the "#" is rendered as "\#" inside the link brackets.
  assert.ok(md.includes('[\\#12](https://github.com/o/r/issues/12)'));
});

test('formatBlameHover: without issueLinking, "#12" is left as escaped plain text, not a link', () => {
  const withIssue: BlameLine = { ...entry, summary: 'fix #12 crash' };
  const md = formatBlameHover(withIssue, null, 'tracked.txt', 'line three', now);
  assert.ok(!md.includes('issues/12'));
  assert.ok(md.includes('\\#12'));
});

test('formatBlameHover: appends an "Explain this line with AI" command link for a committed line', () => {
  const md = formatBlameHover(entry, diffStat, 'tracked.txt', 'line three', now);
  assert.match(md, /\[Explain this line with AI\]\(command:gitLore\.explainLine\?/);
  const match = /command:gitLore\.explainLine\?(\S+)\)/.exec(md);
  assert.ok(match, 'expected an encoded command link');
  const args = JSON.parse(decodeURIComponent(match[1])) as unknown[];
  assert.deepEqual(args, ['tracked.txt', entry.sha, 'line three']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/utils/format.test.ts`
Expected: FAIL — `formatBlameHover` called with too many arguments / link assertion fails (function doesn't emit a link yet)

- [ ] **Step 3: Update `formatBlameHover`**

Replace the full contents of `src/utils/format.ts`:

```typescript
import type { BlameLine, FileChange } from '../core/git/types';
import { formatAge, formatAbsolute } from './date';
import { buildGravatarUrl } from './gravatar';
import { linkifyIssues, type IssueLinkOptions } from './issueLinks';
import { COMMANDS } from '../constants';

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

/**
 * Builds the markdown body for the blame hover card. Pure — the caller wraps the result in
 * a `vscode.MarkdownString` and must set `isTrusted = { enabledCommands: [COMMANDS.explainLine] }`
 * for the "Explain this line with AI" link below to actually be clickable — VS Code ignores
 * command links in untrusted markdown.
 */
export function formatBlameHover(
  entry: BlameLine,
  diffStat: FileChange | null,
  filePath: string,
  lineContent: string,
  now: Date = new Date(),
  issueLinking: IssueLinkOptions | null = null,
): string {
  if (entry.isUncommitted) {
    return '**Uncommitted changes**\n\nThis line has not been committed yet.';
  }

  const date = new Date(entry.authorTime * 1000);
  const avatarUrl = buildGravatarUrl(entry.authorEmail);
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

  const linkArgs = encodeURIComponent(JSON.stringify([filePath, entry.sha, lineContent]));
  lines.push('', `[Explain this line with AI](command:${COMMANDS.explainLine}?${linkArgs})`);

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/utils/format.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Wire `BlameHoverProvider` to pass the new arguments and trust the link**

In `src/providers/BlameHoverProvider.ts`, change the import line:

```typescript
import { CONFIG, COMMANDS } from '../constants';
```

Replace the `return new vscode.Hover(...)` line inside `provideHover` with:

```typescript
      const markdown = new vscode.MarkdownString(
        formatBlameHover(entry, diffStat, doc.uri.fsPath, doc.lineAt(pos.line).text, undefined, issueLinking),
      );
      markdown.isTrusted = { enabledCommands: [COMMANDS.explainLine] };
      return new vscode.Hover(markdown);
```

- [ ] **Step 6: Add the integration test**

Add to `test/integration/hover.test.ts`. First add the import:

```typescript
import { COMMANDS } from '../../src/constants';
```

Then add, inside `suite('Blame hover card', ...)`, after the existing "shows author, message, gravatar, and diff stat" test:

```typescript
  test('offers a command link to explain the line with AI, scoped to just that command', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(2, 0),
    );

    assert.ok(hovers && hovers.length > 0, 'expected at least one hover');
    const content = hovers[0].contents[0] as vscode.MarkdownString;
    assert.match(content.value, new RegExp(`command:${COMMANDS.explainLine}\\?`));
    assert.deepEqual(content.isTrusted, { enabledCommands: [COMMANDS.explainLine] });
  });
```

- [ ] **Step 7: Run the full unit and integration suites**

Run: `npx tsc --noEmit -p .`
Run: `npm run test:unit`
Run: `npm run test:integration`
Expected: all clean; the two touched suites (`format.test.ts` growing to 9 tests, `hover.test.ts` growing to 3) pass alongside everything else.

- [ ] **Step 8: Commit**

```bash
git add src/utils/format.ts src/providers/BlameHoverProvider.ts test/unit/utils/format.test.ts test/integration/hover.test.ts
git commit -m "feat(ai): add Explain This Line's History link to the blame hover"
```

---

### Task 3: Adaptive AI section in `render.ts`

**Files:**
- Modify: `src/views/CommitDetails/render.ts`
- Test: `test/unit/views/commitDetails.render.test.ts`

**Interfaces:**
- Produces: `RenderCommitDetailsOptions.lineExplanation?: boolean` — Task 4's `CommitDetailsViewProvider` passes this from `load()`. Building this option and its template logic before Task 4 (rather than after) means Task 4's own `tsc --noEmit` never sees an unrecognized property on an options object literal — the field already exists by the time anything passes it.

- [ ] **Step 1: Write the failing render tests**

Add to `test/unit/views/commitDetails.render.test.ts`, after the last existing test:

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

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `npx tsx --test test/unit/views/commitDetails.render.test.ts`
Expected: the second test PASSES already (current behavior unchanged); the first FAILS (`lineExplanation` doesn't exist on the options type / heading and disabled button aren't there yet)

- [ ] **Step 3: Add the option and make the section adaptive**

In `src/views/CommitDetails/render.ts`, add the new field to the options interface:

```typescript
export interface RenderCommitDetailsOptions {
  nonce: string;
  cspSource: string;
  /** Stylesheets to link, in order. Shared diff rules first, then the panel's own. */
  styleUris: string[];
  editorFontFamily: string;
  issueLinking?: IssueLinkOptions | null;
  remote?: RemoteTarget | null;
  /** True when opened via the blame hover's "Explain this line with AI" link — the AI section adapts its heading/button and starts the button disabled, since the flow is already running by the time this HTML is sent. */
  lineExplanation?: boolean;
}
```

Replace the AI section block inside `renderCommitDetailsHtml`'s template (currently the `<div class="section-head">${AI_ICON}...AI Summary...` block through the closing `</div>` of `.ai-summary`) with:

```html
<div class="section-head">
${AI_ICON}<span class="section-title">${opts.lineExplanation ? 'Why does this line exist?' : 'AI Summary'}</span>
</div>
<div class="ai-summary">
<button class="btn" id="explain-commit"${opts.lineExplanation ? ' disabled' : ''} type="button">${AI_ICON}${opts.lineExplanation ? 'Explain this line' : 'Summarize with AI'}</button>
<p class="ai-summary-text" id="ai-summary-text" aria-live="polite" hidden></p>
<p class="ai-summary-hint" id="ai-summary-hint" role="status" hidden></p>
</div>
```

No changes are needed to the inline `<script>` block — the existing `aiSummaryChunk`/`aiSummaryCached`/`aiSummaryDone`/`aiSummaryReset`/`aiSummaryNoModel`/`aiSummaryError` handlers already flip `explainBtn.disabled` back to `false` on completion, and they fire identically whether the flow was started by a click or by the provider auto-running it before the webview even finished loading.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/views/commitDetails.render.test.ts`
Expected: PASS (all tests, including both new ones)

- [ ] **Step 5: Run the full suite**

Run: `npx tsc --noEmit -p .`
Run: `npm run lint`
Run: `npm run test:unit`
Run: `npm run test:integration`
Expected: all clean — nothing outside `render.ts` and its own unit test changed, so the integration suite is unaffected by this task; running it confirms that.

- [ ] **Step 6: Commit**

```bash
git add src/views/CommitDetails/render.ts test/unit/views/commitDetails.render.test.ts
git commit -m "feat(ai): adapt the Commit Details AI section for line explanations"
```

---

### Task 4: `CommitDetailsViewProvider.explainLine()` + command wiring

**Files:**
- Modify: `src/views/CommitDetails/CommitDetailsViewProvider.ts`
- Modify: `src/commands/aiCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Modify: `test/unit/contributions.test.ts`
- Test: `test/integration/commitDetails.test.ts`

**Interfaces:**
- Consumes: `buildLineExplanationPrompt` (Task 1); `RenderCommitDetailsOptions.lineExplanation` (Task 3 — already exists by the time this task passes it).
- Produces: `CommitDetailsViewProvider.explainLine(lineContent: string): Promise<void>`; `CommitDetailsViewProvider.show(filePath: string, sha: string, lineContent?: string): Promise<void>` (extended signature — existing callers passing only 2 args are unaffected).

- [ ] **Step 1: Refactor `explainCommit()` into a shared `runAiFlow`, add `explainLine()`**

In `src/views/CommitDetails/CommitDetailsViewProvider.ts`, update the import of prompt builders:

```typescript
import { buildCommitSummaryPrompt, buildLineExplanationPrompt } from '../../core/ai/prompts';
```

Replace the entire `explainCommit()` method with:

```typescript
  async explainCommit(): Promise<void> {
    await this.runAiFlow((commit, diff, maxDiffChars) => buildCommitSummaryPrompt(commit, diff, maxDiffChars), '');
  }

  /** Auto-invoked by `load()` when opened via the blame hover's "Explain this line with AI" link — the hover click is the user action that authorizes the model call, so no second click is required here. */
  async explainLine(lineContent: string): Promise<void> {
    await this.runAiFlow(
      (commit, diff, maxDiffChars) => buildLineExplanationPrompt(commit, diff, lineContent, maxDiffChars),
      `:line:${lineContent}`,
    );
  }

  /**
   * Shared by `explainCommit()` and `explainLine()` — same disabled/cache/no-model/streaming/error
   * handling either way. `cacheKeySuffix` keeps a whole-commit summary and a line explanation (or
   * two different lines' explanations) of the same commit from colliding in `aiSummaryCache`.
   */
  private async runAiFlow(
    promptBuilder: (commit: CommitDetail, diff: string, maxDiffChars: number) => string,
    cacheKeySuffix: string,
  ): Promise<void> {
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
    const cacheKey = `${repoRoot ?? filePath}:${commit.sha}${cacheKeySuffix}`;
    const cached = this.aiSummaryCache.get(cacheKey);

    const flow = runCommitSummaryFlow({
      enabled,
      cached,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => promptBuilder(commit, diff, maxDiffChars),
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
```

(This replaces the single old `explainCommit()` method with three methods: the two thin public ones plus the shared private `runAiFlow` — the body of `runAiFlow` is the old `explainCommit()` body unchanged except `buildCommitSummaryPrompt(commit, diff, maxDiffChars)` became the generic `promptBuilder(commit, diff, maxDiffChars)`.)

- [ ] **Step 2: Extend `show()` and `load()` to accept and auto-run line context**

Replace the `show()` method:

```typescript
  /** Called by "Show Commit Details" (no `lineContent`) or the blame hover's explain-line link (with it) — reveals the panel tab, loads the commit, and auto-runs the line explanation when `lineContent` is given. */
  async show(filePath: string, sha: string, lineContent?: string): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.commitDetails}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, sha, lineContent);
  }
```

Replace the `load()` method's signature and its two call sites of `renderCommitDetailsHtml`/the end of the try block:

```typescript
  private async load(filePath: string, sha: string, lineContent?: string): Promise<void> {
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
          lineExplanation: lineContent !== undefined,
        },
      );

      if (lineContent !== undefined) {
        await this.explainLine(lineContent);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitLore: failed to load commit — ${escapeHtml(message)}</p>`);
    }
  }
```

(`lineExplanation` already exists on `RenderCommitDetailsOptions` from Task 3, so this compiles cleanly — no transient type error.)

- [ ] **Step 3: Add `handleExplainLineCommand`**

Append to `src/commands/aiCommands.ts`:

```typescript
export function handleExplainLineCommand(provider: CommitDetailsViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand(
    COMMANDS.explainLine,
    async (filePath?: string, sha?: string, lineContent?: string) => {
      if (!filePath || !sha || lineContent === undefined) {
        void vscode.window.showInformationMessage('GitLore: pick a line with committed history to explain.');
        return;
      }
      await provider.show(filePath, sha, lineContent);
    },
  );
}
```

- [ ] **Step 4: Wire the command in `extension.ts`**

Change the import line:

```typescript
import { handleExplainCommitCommand, handleExplainLineCommand } from './commands/aiCommands';
```

Add to the `ctx.subscriptions.push(...)` list, right after `handleExplainCommitCommand(commitDetailsViewProvider),`:

```typescript
    handleExplainLineCommand(commitDetailsViewProvider),
```

- [ ] **Step 5: Declare the command in `package.json`, hidden from the palette**

Add to `contributes.commands`, after the `gitLore.explainCommit` entry:

```json
      {
        "command": "gitLore.explainLine",
        "title": "GitLore: Explain This Line's History",
        "icon": "$(sparkle)"
      }
```

Add to `contributes.menus.commandPalette` (it currently has one entry, for `gitLore.copySha`):

```json
        {
          "command": "gitLore.explainLine",
          "when": "false"
        }
```

- [ ] **Step 6: Update `test/unit/contributions.test.ts`**

Change:

```typescript
  const reserved = new Set<string>([COMMANDS.explainLine]);
```

to:

```typescript
  const reserved = new Set<string>([]);
```

(No commands are Phase-2-reserved-but-uncontributed anymore — both `explainCommit` and `explainLine` are now declared. If a future sub-project reserves a new command, it goes back in this set.)

Change the existing palette-hiding test from:

```typescript
test('commandPalette: copySha is hidden, because there is no commit selected there', () => {
  const hidden = (menus['commandPalette'] ?? []).filter((e) => e.when === 'false').map((e) => e.command);
  assert.ok(hidden.includes(COMMANDS.copySha), 'gitLore.copySha must be hidden from the command palette');
});
```

to:

```typescript
test('commandPalette: commands that need arguments a manual invocation cannot supply are hidden', () => {
  const hidden = (menus['commandPalette'] ?? []).filter((e) => e.when === 'false').map((e) => e.command);
  assert.ok(hidden.includes(COMMANDS.copySha), 'gitLore.copySha must be hidden from the command palette');
  assert.ok(hidden.includes(COMMANDS.explainLine), 'gitLore.explainLine must be hidden from the command palette');
});
```

- [ ] **Step 7: Add the integration test**

Add to `test/integration/commitDetails.test.ts`, after the tests added for `explainCommit` in the prior plan (reuses the existing `withAiConfig` helper already defined in this file — do not redefine it):

```typescript
  test('opening via a line explanation link auto-runs the flow with no extra command', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);

    // executeCommand returns a Thenable, not a Promise — withAiConfig requires the latter, same
    // mismatch fixed the same way when explainCommit's command-wiring test was added.
    await withAiConfig(true, () =>
      Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
    );

    assert.deepEqual(api.getAiSummaryMessagesForTest(), [{ type: 'aiSummaryNoModel' }]);
  });

  test('gitLore.explainLine with missing arguments shows an info message instead of throwing', async () => {
    await vscode.commands.executeCommand(COMMANDS.explainLine);
  });

  test('the panel shows the line-focused heading and a pre-disabled button when opened via explainLine', async () => {
    const commit = manifest.commits[0];
    assert.ok(commit);

    await withAiConfig(true, () =>
      Promise.resolve(vscode.commands.executeCommand(COMMANDS.explainLine, manifest.trackedFile, commit.sha, 'line three')),
    );

    const html = api.getCommitDetailsHtml() ?? '';
    assert.match(html, /Why does this line exist\?/);
    assert.match(html, /id="explain-commit" disabled/);
  });
```

- [ ] **Step 8: Run the full suite**

Run: `npx tsc --noEmit -p .`
Run: `npm run lint`
Run: `npm run test:unit`
Run: `npm run test:integration`
Expected: all clean. `contributions.test.ts` now passes with the emptied `reserved` set; the three new `commitDetails.test.ts` tests pass — including the line-focused-heading one, which exercises Task 3's `render.ts` template change end-to-end for the first time via the command this task adds.

- [ ] **Step 9: Commit**

```bash
git add src/views/CommitDetails/CommitDetailsViewProvider.ts src/commands/aiCommands.ts src/extension.ts package.json test/unit/contributions.test.ts test/integration/commitDetails.test.ts
git commit -m "feat(ai): wire gitLore.explainLine into Commit Details"
```

---

## Definition of Done (mirrors `CLAUDE.md` §16)

- [ ] Hover link appears only for committed lines, is scoped-trusted, and is correctly encoded/decoded.
- [ ] `gitLore.explainLine` is hidden from the command palette (needs args a manual invocation can't supply) but reachable via the hover link.
- [ ] Auto-run path never bypasses `gitLore.ai.enabled` or the no-model hint — both are exercised through the exact same `runAiFlow` code path as `explainCommit`.
- [ ] Cache keys for a whole-commit summary and a per-line explanation of the same commit never collide.
- [ ] Unit tests for `buildLineExplanationPrompt`, `formatBlameHover`'s link, and `render.ts`'s adaptive section; integration tests for the hover link, the auto-run behavior, and the disabled-on-load button.
- [ ] `CHANGELOG.md` `## [Unreleased]` updated with this feature (manual step, not automated by this plan).
- [ ] `npm run lint` and `npm run test` pass clean.
