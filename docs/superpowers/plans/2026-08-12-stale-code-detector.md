# Stale-Code Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A subtle CodeLens above stale functions/methods (untouched for more than `gitLore.staleThresholdDays`), reusing GitLore's existing blame cache and VS Code's built-in document-symbol providers — no new parser dependency.

**Architecture:** A new pure function (`core/git/staleness.ts`) finds the most-recently-touched line in a symbol's range from blame data already fetched by the shared `BlameSource`; a new `StaleCodeLensProvider` (`providers/CodeLensProvider.ts`) walks `vscode.executeDocumentSymbolProvider`'s output (top-level functions, plus one level into classes for methods/constructors — never deeper), calls the pure function per candidate, and turns stale results into `vscode.CodeLens`es whose command opens Commit Details for the exact commit that made them stale, reusing `gitLore.showCommit`.

**Tech Stack:** TypeScript (strict), VS Code Extension API (`vscode.languages.registerCodeLensProvider`, `vscode.executeDocumentSymbolProvider`), existing `BlameSource`/`GitService`, `node:test` for unit tests, `@vscode/test-electron` for integration tests.

## Global Constraints

- No `any`. No non-null `!` without an inline comment justifying it — this plan needs neither.
- `core/git/staleness.ts` must have **zero** `vscode` imports — pure data in, pure data out, unit-testable without a VS Code host.
- Reuse the existing shared `BlameSource` (in `src/providers/BlameSource.ts`) for blame data — do not create a second blame cache. It already handles debounced (500ms) file-watcher invalidation and a per-repo HEAD watcher; nothing new is needed there.
- `gitLore.staleCode.enabled` defaults to `true`; `gitLore.staleThresholdDays` defaults to `180`.
- Command titles in `package.json` are namespaced `GitLore: ...` — not applicable here, since this feature adds no new command (it reuses `gitLore.showCommit`).
- Every `Disposable` goes into `context.subscriptions` in `extension.ts`.
- **Never run `git commit`.** This project's owner commits personally, in their own batches — no exceptions, including for whoever/whatever executes this plan. Every task below ends with a "Stage the changes" step (`git add` only); do not run `git commit` for any reason, and do not ask whether to commit.
- Follow the existing test split: unit tests only for code with zero `vscode` imports; anything touching real `vscode.SymbolKind`/`vscode.DocumentSymbol`/`vscode.commands.executeCommand` is integration-tested against a real Extension Development Host, per the existing `test/unit` vs `test/integration` split in this repo (unit tests run via `node scripts/run-unit-tests.mjs`, which cannot resolve the `vscode` module at all).

---

### Task 1: Pure staleness computation

**Files:**
- Create: `src/core/git/staleness.ts`
- Test: `test/unit/core/git/staleness.test.ts`

**Interfaces:**
- Consumes: `BlameLine` from `src/core/git/types.ts` (existing — fields: `line: number`, `sha: string`, `author: string`, `authorEmail: string`, `authorTime: number` (Unix seconds), `summary: string`, `isUncommitted: boolean`).
- Produces: `export interface StaleInfo { sha: string; lastTouched: Date; ageDays: number }` and `export function findStaleSymbol(blameLines: BlameLine[], startLine: number, endLine: number, thresholdDays: number, now: Date): StaleInfo | null` — both consumed by Task 3's `StaleCodeLensProvider`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/core/git/staleness.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findStaleSymbol } from '../../../../src/core/git/staleness';
import type { BlameLine } from '../../../../src/core/git/types';

process.env.TZ = 'UTC';

const now = new Date('2024-06-01T00:00:00Z');

function daysAgo(days: number): number {
  return Math.floor((now.getTime() - days * 86_400_000) / 1000);
}

function line(overrides: Partial<BlameLine> & { line: number }): BlameLine {
  return {
    sha: 'deadbeef',
    author: 'Amy Dev',
    authorEmail: 'amy@example.com',
    authorTime: daysAgo(0),
    summary: 'a commit',
    isUncommitted: false,
    ...overrides,
  };
}

test('findStaleSymbol: returns null when the most recently touched line is within the threshold', () => {
  const blameLines = [line({ line: 0, authorTime: daysAgo(10) }), line({ line: 1, authorTime: daysAgo(5) })];
  assert.equal(findStaleSymbol(blameLines, 0, 1, 180, now), null);
});

test('findStaleSymbol: returns the sha and age of the most recently touched line, when older than the threshold', () => {
  const blameLines = [
    line({ line: 0, sha: 'aaa111', authorTime: daysAgo(200) }),
    line({ line: 1, sha: 'bbb222', authorTime: daysAgo(210) }),
  ];
  const result = findStaleSymbol(blameLines, 0, 1, 180, now);
  assert.ok(result);
  assert.equal(result.sha, 'aaa111'); // line 0 is the more recent of the two — 200 days old, not 210
  assert.equal(result.lastTouched.getTime(), daysAgo(200) * 1000);
  assert.ok(Math.abs(result.ageDays - 200) < 0.01);
});

test('findStaleSymbol: takes the most recent line, not the oldest — a fresh line keeps the symbol non-stale even if an older line in range would be stale alone', () => {
  const blameLines = [
    line({ line: 0, authorTime: daysAgo(40) }), // would be stale alone at a 30-day threshold
    line({ line: 1, authorTime: daysAgo(10) }), // most recent — keeps the whole range non-stale
  ];
  assert.equal(findStaleSymbol(blameLines, 0, 1, 30, now), null);
});

test('findStaleSymbol: any uncommitted line in range means "actively being edited", never stale', () => {
  const blameLines = [
    line({ line: 0, authorTime: daysAgo(400) }),
    line({ line: 1, isUncommitted: true, authorTime: daysAgo(0) }),
  ];
  assert.equal(findStaleSymbol(blameLines, 0, 1, 180, now), null);
});

test('findStaleSymbol: returns null when no blame line falls inside the range', () => {
  const blameLines = [line({ line: 5, authorTime: daysAgo(400) })];
  assert.equal(findStaleSymbol(blameLines, 0, 2, 180, now), null);
});

test('findStaleSymbol: exactly at the threshold is not yet stale (boundary is exclusive)', () => {
  const blameLines = [line({ line: 0, authorTime: daysAgo(180) })];
  assert.equal(findStaleSymbol(blameLines, 0, 0, 180, now), null);
});

test('findStaleSymbol: one day past the threshold is stale', () => {
  const blameLines = [line({ line: 0, sha: 'ccc333', authorTime: daysAgo(181) })];
  const result = findStaleSymbol(blameLines, 0, 0, 180, now);
  assert.ok(result);
  assert.equal(result.sha, 'ccc333');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test test/unit/core/git/staleness.test.ts`
Expected: FAIL — `Cannot find module '../../../../src/core/git/staleness'`

- [ ] **Step 3: Write the implementation**

Create `src/core/git/staleness.ts`:

```ts
import type { BlameLine } from './types';

/** Zero `vscode` imports — pure data in, pure data out, per GitLore's `core/` dependency rule. */
export interface StaleInfo {
  sha: string;
  lastTouched: Date;
  ageDays: number;
}

/**
 * Finds the most recently touched line inside [startLine, endLine] (inclusive, 0-based, matching
 * both `BlameLine.line` and `vscode.Position.line`) and reports it as stale if that line is older
 * than `thresholdDays`. Any uncommitted line in range means the symbol is being actively edited
 * right now — the opposite of stale — so the whole range is reported as not-stale regardless of
 * how old its other lines are.
 */
export function findStaleSymbol(
  blameLines: BlameLine[],
  startLine: number,
  endLine: number,
  thresholdDays: number,
  now: Date,
): StaleInfo | null {
  const inRange = blameLines.filter((l) => l.line >= startLine && l.line <= endLine);
  if (inRange.length === 0 || inRange.some((l) => l.isUncommitted)) {
    return null;
  }

  let newest: BlameLine | null = null;
  for (const candidate of inRange) {
    if (newest === null || candidate.authorTime > newest.authorTime) {
      newest = candidate;
    }
  }
  if (newest === null) {
    return null;
  }

  const lastTouched = new Date(newest.authorTime * 1000);
  const ageDays = (now.getTime() - lastTouched.getTime()) / 86_400_000;
  if (ageDays <= thresholdDays) {
    return null;
  }

  return { sha: newest.sha, lastTouched, ageDays };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test test/unit/core/git/staleness.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Stage the changes**

```bash
git add src/core/git/staleness.ts test/unit/core/git/staleness.test.ts
```

Do not commit — see Global Constraints.

---

### Task 2: Settings and constants

**Files:**
- Modify: `src/constants.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CONFIG.staleCodeEnabled` (string value `'staleCode.enabled'`) and `CONFIG.staleThresholdDays` (string value `'staleThresholdDays'`) — both read via `vscode.workspace.getConfiguration(CONFIG.section).get(...)` by Task 3's `StaleCodeLensProvider`.

- [ ] **Step 1: Add the two config keys to `CONFIG` in `src/constants.ts`**

In `src/constants.ts`, the existing `CONFIG` object is:

```ts
export const CONFIG = {
  section: 'gitLore',
  blameEnabled: 'blame.enabled',
  blameFormat: 'blame.format',
  blameHighlightCurrentLine: 'blame.highlightCurrentLine',
  blameIgnoreWhitespace: 'blame.ignoreWhitespace',
  maxHistoryItems: 'maxHistoryItems',
  maxBlameFileSize: 'maxBlameFileSize',
  maxGraphItems: 'maxGraphItems',
  dateFormat: 'dateFormat',
  issueLinkingEnabled: 'issueLinking.enabled',
  issueLinkingPattern: 'issueLinking.pattern',
  issueLinkingUrlTemplate: 'issueLinking.urlTemplate',
  aiEnabled: 'ai.enabled',
  aiModelFamily: 'ai.modelFamily',
  aiMaxDiffChars: 'ai.maxDiffChars',
} as const;
```

Add two new entries (keep alphabetical grouping loose but put them near `maxBlameFileSize` since they're used together by the same provider):

```ts
export const CONFIG = {
  section: 'gitLore',
  blameEnabled: 'blame.enabled',
  blameFormat: 'blame.format',
  blameHighlightCurrentLine: 'blame.highlightCurrentLine',
  blameIgnoreWhitespace: 'blame.ignoreWhitespace',
  maxHistoryItems: 'maxHistoryItems',
  maxBlameFileSize: 'maxBlameFileSize',
  maxGraphItems: 'maxGraphItems',
  dateFormat: 'dateFormat',
  staleCodeEnabled: 'staleCode.enabled',
  staleThresholdDays: 'staleThresholdDays',
  issueLinkingEnabled: 'issueLinking.enabled',
  issueLinkingPattern: 'issueLinking.pattern',
  issueLinkingUrlTemplate: 'issueLinking.urlTemplate',
  aiEnabled: 'ai.enabled',
  aiModelFamily: 'ai.modelFamily',
  aiMaxDiffChars: 'ai.maxDiffChars',
} as const;
```

- [ ] **Step 2: Add the two settings to `package.json`**

In `package.json`, find `contributes.configuration.properties` (it currently ends with `gitLore.ai.maxDiffChars`). Add two new properties after `gitLore.maxGraphItems` and before `gitLore.issueLinking.enabled`:

```json
    "gitLore.staleCode.enabled": {
      "type": "boolean",
      "default": true,
      "description": "Show a CodeLens above functions and methods that haven't changed in longer than staleThresholdDays."
    },
    "gitLore.staleThresholdDays": {
      "type": "number",
      "default": 180,
      "description": "Days since a function's or method's last change before it's flagged as stale."
    },
```

- [ ] **Step 3: Verify the manifest is still valid JSON and the project still type-checks**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('valid json')"`
Expected: prints `valid json`

Run: `npm run lint`
Expected: passes clean (no new lint/type errors — `CONFIG.staleCodeEnabled`/`CONFIG.staleThresholdDays` aren't consumed by any code yet, which is fine; they're plain string constants).

- [ ] **Step 4: Stage the changes**

```bash
git add src/constants.ts package.json
```

Do not commit — see Global Constraints.

---

### Task 3: StaleCodeLensProvider, wiring, and end-to-end tests

**Files:**
- Create: `src/providers/CodeLensProvider.ts`
- Modify: `src/extension.ts`
- Modify: `test/fixtures/build-fixture-repo.ts`
- Create: `test/integration/codeLens.test.ts`

**Interfaces:**
- Consumes: `findStaleSymbol`, `StaleInfo` from `src/core/git/staleness.ts` (Task 1); `CONFIG.staleCodeEnabled`, `CONFIG.staleThresholdDays`, `CONFIG.maxBlameFileSize`, `COMMANDS.showCommit` from `src/constants.ts` (Task 2 + existing); `BlameSource` (existing, `src/providers/BlameSource.ts`) — specifically `getBlameLines(filePath: string, opts: BlameOptions): Promise<BlameLine[] | null>` and `onInvalidate(listener: (repoRoot: string) => void): vscode.Disposable`; `formatAge(date: Date, now?: Date): string` from `src/utils/date.ts`.
- Produces: `export class StaleCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable` — constructed with `new StaleCodeLensProvider(blameSource)` and registered via `vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider)`.

#### Part A — the provider

- [ ] **Step 1: Write `src/providers/CodeLensProvider.ts`**

```ts
import * as vscode from 'vscode';
import type { BlameSource } from './BlameSource';
import { findStaleSymbol } from '../core/git/staleness';
import { formatAge } from '../utils/date';
import { CONFIG, COMMANDS } from '../constants';

const DEFAULT_MAX_BLAME_FILE_SIZE = 1_048_576;
const DEFAULT_STALE_THRESHOLD_DAYS = 180;

/**
 * Walks a document's top-level symbols for stale-check candidates: top-level functions, plus one
 * level into a class for its methods/constructors. Never recurses further — a function nested
 * inside another function is never flagged, and a class's own declaration line never gets its own
 * lens (its range spans every method inside it, so a stale class would otherwise double up with
 * every one of its already-flagged stale methods).
 */
function collectCandidates(symbols: readonly vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const candidates: vscode.DocumentSymbol[] = [];
  for (const symbol of symbols) {
    if (symbol.kind === vscode.SymbolKind.Function) {
      candidates.push(symbol);
    } else if (symbol.kind === vscode.SymbolKind.Class) {
      for (const child of symbol.children) {
        if (child.kind === vscode.SymbolKind.Method || child.kind === vscode.SymbolKind.Constructor) {
          candidates.push(child);
        }
      }
    }
  }
  return candidates;
}

/** Flags functions/methods untouched for longer than `gitLore.staleThresholdDays`, per §7 Phase 2 of CLAUDE.md. */
export class StaleCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
  private readonly invalidateDisposable: vscode.Disposable;

  constructor(private readonly source: BlameSource) {
    this.invalidateDisposable = this.source.onInvalidate(() => {
      this.onDidChangeCodeLensesEmitter.fire();
    });
  }

  dispose(): void {
    this.invalidateDisposable.dispose();
    this.onDidChangeCodeLensesEmitter.dispose();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    if (!config.get<boolean>(CONFIG.staleCodeEnabled, true) || document.uri.scheme !== 'file') {
      return [];
    }

    const maxSize = config.get<number>(CONFIG.maxBlameFileSize, DEFAULT_MAX_BLAME_FILE_SIZE);
    if (Buffer.byteLength(document.getText(), 'utf8') > maxSize) {
      return [];
    }

    const filePath = document.uri.fsPath;
    const blameLines = await this.source.getBlameLines(filePath, {});
    if (!blameLines || blameLines.length === 0) {
      return [];
    }

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    if (!symbols || symbols.length === 0) {
      return [];
    }

    const thresholdDays = config.get<number>(CONFIG.staleThresholdDays, DEFAULT_STALE_THRESHOLD_DAYS);
    const now = new Date();
    const lenses: vscode.CodeLens[] = [];

    for (const symbol of collectCandidates(symbols)) {
      const stale = findStaleSymbol(blameLines, symbol.range.start.line, symbol.range.end.line, thresholdDays, now);
      if (!stale) {
        continue;
      }
      const range = new vscode.Range(symbol.range.start, symbol.range.start);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `Stale · last changed ${formatAge(stale.lastTouched, now)}`,
          command: COMMANDS.showCommit,
          arguments: [filePath, stale.sha],
        }),
      );
    }

    return lenses;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: passes clean.

#### Part B — wiring into `extension.ts`

- [ ] **Step 3: Register the provider**

In `src/extension.ts`:

1. Add the import, alongside the other provider imports:

```ts
import { StaleCodeLensProvider } from './providers/CodeLensProvider';
```

2. After the line `const hoverProvider = new BlameHoverProvider(blameSource, git, lineExplanationStore);`, add:

```ts
  const staleCodeLensProvider = new StaleCodeLensProvider(blameSource);
```

3. In the `ctx.subscriptions.push(...)` call, add two entries — the provider itself (it's a `Disposable`, per the same pattern as `blameProvider`) and its registration:

```ts
  ctx.subscriptions.push(
    blameSource,
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    staleCodeLensProvider,
    handleToggleBlameCommand(blameProvider),
    handleShowFileHistoryCommand(fileHistoryProvider),
    handleCopyShaCommand(),
    handleShowCommitCommand(commitDetailsViewProvider),
    handleOpenGraphCommand(commitGraphViewProvider),
    handleCompareBranchesCommand(git, branchComparisonViewProvider),
    handleExplainCommitCommand(commitDetailsViewProvider),
    handleExplainLineCommand(lineExplanationService),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, staleCodeLensProvider),
    // Backs the "Open changes" action in the commit-details and branch-comparison panels by
    // serving a file's contents at an arbitrary ref to the native diff editor.
    vscode.workspace.registerTextDocumentContentProvider(SCHEMES.gitContent, new GitContentProvider(git)),
    vscode.window.registerWebviewViewProvider(VIEWS.commitGraph, commitGraphViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.commitDetails, commitDetailsViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.branchComparison, branchComparisonViewProvider),
  );
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: passes clean.

#### Part C — fixture repo for integration tests

- [ ] **Step 5: Add `buildStaleFixtureRepo` to `test/fixtures/build-fixture-repo.ts`**

This is a new, separate fixture builder (its own isolated temp repo), matching the existing `buildBranchFixtureRepo` pattern — **do not** add these files/commits to the shared `buildFixtureRepo()`, since several existing tests (`commitDetails.test.ts`, `hover.test.ts`, `issueLinking.test.ts`) hardcode `manifest.commits[0]` to mean "the newest commit, 'add line three' by Amy Dev"; appending commits there would shift that index and break them.

Append this to the end of `test/fixtures/build-fixture-repo.ts`:

```ts
export interface StaleFixtureManifest {
  repoRoot: string;
  staleFile: string;
  /** SHA of the commit that last touched every symbol except `recentlyChangedFunction`. */
  staleSha: string;
}

const STALE_FILE_CONTENT_V1 = `export function longUnchangedFunction() {
  return 1;
}

export function recentlyChangedFunction() {
  return 2;
}

export class OldService {
  run() {
    return 1;
  }
}

export function outerFunction() {
  function innerHelper() {
    return 1;
  }
  return innerHelper();
}
`;

// Written out in full (not derived from V1 via string surgery) so the two versions stay easy to
// diff by eye and an edit to one can't silently desync from the other.
const STALE_FILE_CONTENT_V2 = `export function longUnchangedFunction() {
  return 1;
}

export function recentlyChangedFunction() {
  return 3;
}

export class OldService {
  run() {
    return 1;
  }
}

export function outerFunction() {
  function innerHelper() {
    return 1;
  }
  return innerHelper();
}
`;

/**
 * A `.ts` fixture (TypeScript's built-in language server provides real document symbols for it,
 * which the plain `tracked.txt` used elsewhere can't) with one old commit touching every symbol,
 * and a second, effectively-"just now" commit that touches only `recentlyChangedFunction` — giving
 * the stale-code-detector tests both a definitely-stale and a definitely-fresh function in one file.
 */
export function buildStaleFixtureRepo(): StaleFixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-stale-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const staleFile = join(repoRoot, 'stale.ts');
  writeFileSync(staleFile, STALE_FILE_CONTENT_V1);
  git(repoRoot, ['add', 'stale.ts']);
  // Far enough in the past to stay well past any plausible staleThresholdDays for decades.
  git(repoRoot, ['commit', '-q', '-m', 'add stale.ts'], commitEnv('Raj Jadon', 'raj@example.com', '2015-01-01T10:00:00'));

  const staleSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

  writeFileSync(staleFile, STALE_FILE_CONTENT_V2);
  git(repoRoot, ['add', 'stale.ts']);
  // Dated "now" (at fixture-build time, which happens immediately before the suite runs) so this
  // function is always fresh relative to the real wall-clock `now` the provider uses internally.
  git(repoRoot, ['commit', '-q', '-m', 'update recentlyChangedFunction'], commitEnv('Amy Dev', 'amy@example.com', new Date().toISOString()));

  return { repoRoot, staleFile, staleSha };
}
```

#### Part D — integration tests

- [ ] **Step 6: Write `test/integration/codeLens.test.ts`**

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { buildStaleFixtureRepo, type StaleFixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { EXTENSION_ID } from './extensionId';
import { COMMANDS } from '../../src/constants';

suite('Stale-code CodeLens', () => {
  let manifest: StaleFixtureManifest;

  suiteSetup(async () => {
    manifest = buildStaleFixtureRepo();
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    await ext.activate();
  });

  test('flags a top-level function untouched since the old commit, but not one changed just now', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
    await vscode.window.showTextDocument(doc);

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri,
    );

    assert.ok(lenses, 'expected a code lens result');
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert.ok(
      titles.some((t) => t.includes('Stale')),
      `expected at least one "Stale" lens, got: ${JSON.stringify(titles)}`,
    );
    // recentlyChangedFunction was touched by the second (effectively "now") commit — never stale.
    const text = doc.getText();
    const recentLine = text.split('\n').findIndex((l) => l.includes('recentlyChangedFunction'));
    assert.ok(!lenses.some((l) => l.range.start.line === recentLine), 'recentlyChangedFunction must not be flagged');
  });

  test('flags exactly the top-level function, the class method, and the outer function — never the class itself or the nested helper', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
    await vscode.window.showTextDocument(doc);

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri,
    );
    assert.ok(lenses);

    const lines = doc.getText().split('\n');
    const lineOf = (needle: string): number => lines.findIndex((l) => l.includes(needle));
    const flaggedLines = new Set(lenses.map((l) => l.range.start.line));

    assert.ok(flaggedLines.has(lineOf('function longUnchangedFunction')), 'top-level function must be flagged');
    assert.ok(flaggedLines.has(lineOf('run()')), 'the class method must be flagged');
    assert.ok(flaggedLines.has(lineOf('function outerFunction')), 'the outer function must be flagged');
    assert.ok(!flaggedLines.has(lineOf('class OldService')), 'the class declaration itself must not be flagged');
    assert.ok(!flaggedLines.has(lineOf('function innerHelper')), 'the nested function must never be flagged');
    assert.equal(lenses.length, 3, `expected exactly 3 stale lenses, got ${lenses.length}: ${JSON.stringify(lenses.map((l) => l.command?.title))}`);
  });

  test('a stale lens opens Commit Details for the commit that made it stale', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
    await vscode.window.showTextDocument(doc);

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      doc.uri,
    );
    assert.ok(lenses && lenses.length > 0);
    const lens = lenses[0];
    assert.ok(lens?.command);
    assert.equal(lens.command.command, COMMANDS.showCommit);
    assert.deepEqual(lens.command.arguments, [manifest.staleFile, manifest.staleSha]);
  });

  test('gitLore.staleCode.enabled = false suppresses every lens', async () => {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('staleCode.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.staleFile);
      await vscode.window.showTextDocument(doc);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        doc.uri,
      );
      assert.equal(lenses?.length ?? 0, 0);
    } finally {
      await config.update('staleCode.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
```

- [ ] **Step 7: Confirm no manual test registration is needed**

`test/integration/index.ts` auto-discovers every compiled `*.test.js` file in its own directory via `readdirSync` and adds it to Mocha — it does not list suite files by name. No change is needed there; `codeLens.test.ts` will be picked up automatically once compiled.

- [ ] **Step 8: Run the full test suite**

Run: `npm run test:unit`
Expected: PASS — all existing unit tests plus Task 1's 7 new tests green.

Run: `npm run test:integration`
Expected: PASS — all existing integration suites plus the 4 new tests in `codeLens.test.ts` green.

- [ ] **Step 9: Update the changelog**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, after the existing "**AI line explanations**" block, add:

```markdown
**Stale-code detector**

- Functions and methods untouched for longer than `gitLore.staleThresholdDays` (default 180) get a subtle CodeLens — click it to open Commit Details for the commit that last changed them.
- On by default. Turn it off with `gitLore.staleCode.enabled`.
- Works for any language with a symbol provider installed (uses VS Code's built-in `executeDocumentSymbolProvider` — no new parser).
```

(README.md's feature list is updated less consistently in practice — the two preceding AI features shipped without a README update — so it's a nice-to-have here, not a blocking step.)

- [ ] **Step 10: Stage the changes**

```bash
git add src/providers/CodeLensProvider.ts src/extension.ts test/fixtures/build-fixture-repo.ts test/integration/codeLens.test.ts CHANGELOG.md
```

Do not commit — see Global Constraints.

---

## Verification (whole feature)

- [ ] `npm run lint` passes clean (ESLint + `tsc --noEmit`).
- [ ] `npm run test:unit` passes clean, including the 7 new `staleness.test.ts` cases.
- [ ] `npm run test:integration` passes clean, including the 4 new `codeLens.test.ts` cases.
- [ ] Manual check in the Extension Development Host (F5): open a TypeScript file with a function last touched a long time ago (e.g. this very repo has plenty) — confirm a "Stale · last changed ..." CodeLens appears above it, and clicking it opens Commit Details for the right commit. Toggle `gitLore.staleCode.enabled` off in Settings and confirm the lens disappears.
- [ ] `CHANGELOG.md`'s `## [Unreleased]` section updated to mention the stale-code detector (Task 3, Step 9).
