# Author Ownership Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in overview-ruler "heatmap" coloring every line by its blame author, plus a `gitLore.showFileOwnership` command that lists each author's recency-weighted ownership percentage for the current file — closing the last remaining Phase 2 roadmap item.

**Architecture:** A shared color-palette utility (`utils/colors.ts`) replaces `CommitGraph`'s local lane-color array so both the graph and the new heatmap use the same stable per-identity coloring. A new pure module (`core/git/ownership.ts`) does two independent things with the same blame data: a direct per-line color lookup (for the ruler) and a recency-weighted aggregate score per author (for the command's ranking). Both the new `OwnershipDecorationProvider` and the new command reuse the existing `BlameSource` cache — no new git-fetching path.

**Tech Stack:** TypeScript (strict), VS Code Extension API (`TextEditorDecorationType` with `overviewRulerColor`/`overviewRulerLane`, `ThemeColor`, `window.showQuickPick`), existing `BlameSource`/`GitService`, `node:test` for unit tests, `@vscode/test-electron` for integration tests.

## Global Constraints

- No `any`. No non-null `!` without an inline comment justifying it.
- `core/git/ownership.ts` must have **zero** `vscode` imports — pure data in, pure data out. It may import from `src/utils/colors.ts`, which is also `vscode`-import-free (same as every other file already in `utils/`).
- Reuse the existing shared `BlameSource` for blame data — do not create a second blame cache.
- `gitLore.ownership.enabled` defaults to `false` (opt-in — a more opinionated visual than inline blame). The `gitLore.showFileOwnership` command works regardless of this setting.
- The half-life constant (180 days) is hardcoded (`HALF_LIFE_DAYS` in `core/git/ownership.ts`) — not a setting.
- The QuickPick items are plain text (`label`/`description`/`detail`) — **no color swatch/icon**. This was in the original design but was found, while writing this plan, to not actually work: `ThemeIcon`'s `color` parameter is documented in `@types/vscode` as "currently only used in `TreeItem`," so it has no effect on a `QuickPickItem.iconPath`. Don't try to add one back without solving that constraint first.
- `DecorationRenderOptions.overviewRulerColor` is `string | vscode.ThemeColor` (verified in `@types/vscode`) and is fixed per decoration **type**, not settable per-range — so painting N colors requires N decoration types, each given its own subset of line ranges. This is a real API constraint, not a design choice to simplify away.
- Every `Disposable` goes into `context.subscriptions` in `extension.ts`.
- **Never run `git commit`.** This project's owner commits personally, in their own batches — no exceptions, including for whoever/whatever executes this plan. Every task below ends with a "Stage the changes" step (`git add` only); do not run `git commit` for any reason, and do not ask whether to commit.
- Follow the existing test split: unit tests only for code with zero `vscode` imports (`core/`, `utils/`); anything touching real `vscode.window`/`vscode.workspace`/decorations/`showQuickPick` is integration-tested against a real Extension Development Host.

---

### Task 1: Shared color palette

**Files:**
- Create: `src/utils/colors.ts`
- Test: `test/unit/utils/colors.test.ts`
- Modify: `src/views/CommitGraph/render.ts`

**Interfaces:**
- Produces: `export const CHART_THEME_COLOR_IDS: string[]`, `export function chartCssVarForIndex(index: number): string`, `export function chartThemeColorIdForIndex(index: number): string` — consumed by Task 2 (`CHART_THEME_COLOR_IDS.length`) and Task 4 (`chartThemeColorIdForIndex`).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/utils/colors.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_THEME_COLOR_IDS, chartCssVarForIndex, chartThemeColorIdForIndex } from '../../../src/utils/colors';

test('chartThemeColorIdForIndex: returns the theme color id at that index', () => {
  assert.equal(chartThemeColorIdForIndex(0), 'charts.blue');
  assert.equal(chartThemeColorIdForIndex(1), 'charts.orange');
});

test('chartThemeColorIdForIndex: wraps past the palette length', () => {
  assert.equal(chartThemeColorIdForIndex(CHART_THEME_COLOR_IDS.length), chartThemeColorIdForIndex(0));
});

test('chartCssVarForIndex: returns a CSS var() reference for the theme color id at that index', () => {
  assert.equal(chartCssVarForIndex(0), 'var(--vscode-charts-blue)');
});

test('chartCssVarForIndex: wraps past the palette length', () => {
  assert.equal(chartCssVarForIndex(CHART_THEME_COLOR_IDS.length), chartCssVarForIndex(0));
});

test('chartCssVarForIndex and chartThemeColorIdForIndex agree on the same color for every index', () => {
  for (let i = 0; i < CHART_THEME_COLOR_IDS.length; i++) {
    const expectedVar = `var(--vscode-${chartThemeColorIdForIndex(i).replace('.', '-')})`;
    assert.equal(chartCssVarForIndex(i), expectedVar);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test test/unit/utils/colors.test.ts`
Expected: FAIL — `Cannot find module '../../../src/utils/colors'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/colors.ts`:

```ts
/**
 * VS Code's own categorical palette (Settings UI, extension charts) — theme-aware for free,
 * unlike a hardcoded hex list that could clash on a light theme or a high-contrast theme. Shared
 * by the commit graph's lane coloring (as CSS custom properties in a webview) and the ownership
 * heatmap's per-author coloring (as ThemeColor ids for editor decorations) — both need "stable
 * index → this palette," just in two different string forms.
 */
export const CHART_THEME_COLOR_IDS = [
  'charts.blue',
  'charts.orange',
  'charts.green',
  'charts.purple',
  'charts.red',
  'charts.yellow',
  'charts.foreground',
];

function idForIndex(index: number): string {
  return CHART_THEME_COLOR_IDS[index % CHART_THEME_COLOR_IDS.length] ?? CHART_THEME_COLOR_IDS[0] ?? 'charts.foreground';
}

/** CSS custom property reference for a webview stylesheet, e.g. `var(--vscode-charts-blue)`. */
export function chartCssVarForIndex(index: number): string {
  return `var(--vscode-${idForIndex(index).replace('.', '-')})`;
}

/**
 * VS Code theme color id, for `new vscode.ThemeColor(...)`. Kept as a plain string here (not a
 * real ThemeColor) so this file has zero `vscode` imports and stays importable from `core/`.
 */
export function chartThemeColorIdForIndex(index: number): string {
  return idForIndex(index);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test test/unit/utils/colors.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Refactor `CommitGraph/render.ts` to use the shared palette**

In `src/views/CommitGraph/render.ts`, find:

```ts
import type { GraphNode } from '../../core/graph/layout';
import type { BranchInfo, Ref, WorkingChanges } from '../../core/git/types';
import { formatAge, formatAbsolute } from '../../utils/date';
import { escapeHtml } from '../escapeHtml';
import { buildGravatarUrl } from '../../utils/gravatar';
```

Add the new import after `buildGravatarUrl`'s line:

```ts
import { chartCssVarForIndex } from '../../utils/colors';
```

Then find:

```ts
// VS Code's own categorical palette (Settings UI, extension charts) — theme-aware for free,
// unlike a hardcoded hex list that could clash on a light theme or a high-contrast theme.
const LANE_COLOR_VARS = [
  '--vscode-charts-blue',
  '--vscode-charts-orange',
  '--vscode-charts-green',
  '--vscode-charts-purple',
  '--vscode-charts-red',
  '--vscode-charts-yellow',
  '--vscode-charts-foreground',
];

function laneColor(lane: number): string {
  const name = LANE_COLOR_VARS[lane % LANE_COLOR_VARS.length] ?? LANE_COLOR_VARS[0] ?? '--vscode-charts-foreground';
  return `var(${name})`;
}
```

Replace it with:

```ts
function laneColor(lane: number): string {
  return chartCssVarForIndex(lane);
}
```

- [ ] **Step 6: Run the full render test file to verify it still passes**

Run: `npx tsx --test test/unit/views/commitGraph.render.test.ts`
Expected: PASS — every existing test unchanged, including `'renderGraphHtml: rings each avatar node in its lane color'` which asserts the literal string `stroke="var(--vscode-charts-blue)"` — `chartCssVarForIndex(0)` produces that exact string, so this is a refactor, not a behavior change.

- [ ] **Step 7: Run lint**

Run: `npm run lint`
Expected: passes clean.

- [ ] **Step 8: Stage the changes**

```bash
git add src/utils/colors.ts test/unit/utils/colors.test.ts src/views/CommitGraph/render.ts
```

Do not commit — see Global Constraints.

---

### Task 2: Pure ownership computation

**Files:**
- Create: `src/core/git/ownership.ts`
- Test: `test/unit/core/git/ownership.test.ts`

**Interfaces:**
- Consumes: `BlameLine` from `src/core/git/types.ts` (existing — fields: `line: number`, `sha: string`, `author: string`, `authorEmail: string`, `authorTime: number` (Unix seconds), `summary: string`, `isUncommitted: boolean`); `CHART_THEME_COLOR_IDS` from `src/utils/colors.ts` (Task 1).
- Produces: `export interface AuthorOwnership { author: string; authorEmail: string; lineCount: number; percentage: number; lastActive: Date }`, `export interface LineOwnership { line: number; colorIndex: number }`, `export function computeOwnership(blameLines: BlameLine[], now: Date): AuthorOwnership[]`, `export function computeLineColors(blameLines: BlameLine[]): LineOwnership[]` — both consumed by Task 4 (`computeLineColors`) and Task 5 (`computeOwnership`).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/core/git/ownership.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOwnership, computeLineColors } from '../../../../src/core/git/ownership';
import type { BlameLine } from '../../../../src/core/git/types';

const now = new Date('2024-07-01T00:00:00Z');

function daysAgoSeconds(days: number): number {
  return Math.floor((now.getTime() - days * 86_400_000) / 1000);
}

function line(overrides: Partial<BlameLine> & { line: number }): BlameLine {
  return {
    sha: 'deadbeef',
    author: 'Amy Dev',
    authorEmail: 'amy@example.com',
    authorTime: daysAgoSeconds(0),
    summary: 'a commit',
    isUncommitted: false,
    ...overrides,
  };
}

test('computeOwnership: a single author with all lines today gets 100%', () => {
  const lines = [line({ line: 0 }), line({ line: 1 })];
  const result = computeOwnership(lines, now);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.author, 'Amy Dev');
  assert.equal(result[0]?.lineCount, 2);
  assert.ok(Math.abs((result[0]?.percentage ?? 0) - 100) < 0.001);
});

test('computeOwnership: recency outweighs raw line count — a smaller, more recent share can outrank a larger, older one', () => {
  // Alice: 2 lines from 360 days ago. Bob: 1 line from today. Raw line share would be
  // Alice 66.7% / Bob 33.3%; recency-weighted, Bob's share must be *higher* than his raw count.
  const lines = [
    line({ line: 0, author: 'Alice Dev', authorEmail: 'alice@example.com', authorTime: daysAgoSeconds(360) }),
    line({ line: 1, author: 'Alice Dev', authorEmail: 'alice@example.com', authorTime: daysAgoSeconds(360) }),
    line({ line: 2, author: 'Bob Smith', authorEmail: 'bob@example.com', authorTime: daysAgoSeconds(0) }),
  ];
  const result = computeOwnership(lines, now);
  const alice = result.find((r) => r.authorEmail === 'alice@example.com');
  const bob = result.find((r) => r.authorEmail === 'bob@example.com');
  assert.ok(alice && bob);
  assert.ok(bob.percentage > 100 / 3, `expected Bob's recency-weighted share (${bob.percentage}) above his raw 33.3% line share`);
  assert.ok(alice.percentage < (200 / 3), `expected Alice's recency-weighted share (${alice.percentage}) below her raw 66.7% line share`);
});

test('computeOwnership: percentages sum to 100 across all authors', () => {
  const lines = [
    line({ line: 0, author: 'Alice Dev', authorEmail: 'alice@example.com', authorTime: daysAgoSeconds(10) }),
    line({ line: 1, author: 'Bob Smith', authorEmail: 'bob@example.com', authorTime: daysAgoSeconds(200) }),
    line({ line: 2, author: 'Bob Smith', authorEmail: 'bob@example.com', authorTime: daysAgoSeconds(200) }),
  ];
  const result = computeOwnership(lines, now);
  const total = result.reduce((sum, r) => sum + r.percentage, 0);
  assert.ok(Math.abs(total - 100) < 0.001);
});

test('computeOwnership: excludes uncommitted lines entirely', () => {
  const lines = [
    line({ line: 0, author: 'Amy Dev', authorEmail: 'amy@example.com' }),
    line({ line: 1, isUncommitted: true }),
  ];
  const result = computeOwnership(lines, now);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.lineCount, 1);
});

test('computeOwnership: returns an empty array when every line is uncommitted', () => {
  const lines = [line({ line: 0, isUncommitted: true })];
  assert.deepEqual(computeOwnership(lines, now), []);
});

test('computeOwnership: sorts most-recently-active author first', () => {
  const lines = [
    line({ line: 0, author: 'Old Author', authorEmail: 'old@example.com', authorTime: daysAgoSeconds(300) }),
    line({ line: 1, author: 'Recent Author', authorEmail: 'recent@example.com', authorTime: daysAgoSeconds(1) }),
  ];
  const result = computeOwnership(lines, now);
  assert.equal(result[0]?.authorEmail, 'recent@example.com');
  assert.equal(result[1]?.authorEmail, 'old@example.com');
});

test('computeOwnership: lastActive is the most recent commit touching that author\'s lines, not the oldest', () => {
  const lines = [
    line({ line: 0, author: 'Amy Dev', authorEmail: 'amy@example.com', authorTime: daysAgoSeconds(100) }),
    line({ line: 1, author: 'Amy Dev', authorEmail: 'amy@example.com', authorTime: daysAgoSeconds(5) }),
  ];
  const result = computeOwnership(lines, now);
  assert.equal(result[0]?.lastActive.getTime(), daysAgoSeconds(5) * 1000);
});

test('computeLineColors: excludes uncommitted lines', () => {
  const lines = [line({ line: 0 }), line({ line: 1, isUncommitted: true })];
  const result = computeLineColors(lines);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.line, 0);
});

test('computeLineColors: the same author email always gets the same color index, regardless of how many other authors are present or their order', () => {
  const solo = computeLineColors([line({ line: 0, authorEmail: 'amy@example.com' })]);
  const crowded = computeLineColors([
    line({ line: 0, authorEmail: 'zack@example.com' }),
    line({ line: 1, authorEmail: 'bob@example.com' }),
    line({ line: 2, authorEmail: 'amy@example.com' }),
  ]);
  const amyAlone = solo.find((r) => r.line === 0)?.colorIndex;
  const amyCrowded = crowded.find((r) => r.line === 2)?.colorIndex;
  assert.equal(amyAlone, amyCrowded);
});

test('computeLineColors: different authors can land in different color buckets', () => {
  // Not guaranteed for every possible pair (only 7 colors), but true for this specific pair —
  // pins the hash isn't accidentally constant-for-everyone.
  const result = computeLineColors([
    line({ line: 0, authorEmail: 'amy@example.com' }),
    line({ line: 1, authorEmail: 'completely-different-person@example.com' }),
  ]);
  assert.notEqual(result[0]?.colorIndex, result[1]?.colorIndex);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test test/unit/core/git/ownership.test.ts`
Expected: FAIL — `Cannot find module '../../../../src/core/git/ownership'`

- [ ] **Step 3: Write the implementation**

Create `src/core/git/ownership.ts`:

```ts
import type { BlameLine } from './types';
import { CHART_THEME_COLOR_IDS } from '../../utils/colors';

/**
 * Days for a line's contribution to its author's ownership score to decay by half. Hardcoded for
 * v1, not a setting — see docs/superpowers/specs/2026-08-13-author-ownership-heatmap-design.md.
 */
const HALF_LIFE_DAYS = 180;

export interface AuthorOwnership {
  author: string;
  authorEmail: string;
  lineCount: number;
  /** 0-100, recency-weighted, summing to 100 (within floating-point tolerance) across all returned authors. */
  percentage: number;
  lastActive: Date;
}

export interface LineOwnership {
  /** 0-based line index, matching `BlameLine.line`. */
  line: number;
  /** Stable per-author index into the shared chart-color palette (see `utils/colors.ts`). */
  colorIndex: number;
}

/** A simple, deterministic string hash (djb2-like) — stable across runs/processes. */
function hashToIndex(value: string, modulus: number): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulus;
}

function decayWeight(ageDays: number): number {
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/**
 * Direct per-line color assignment for the overview-ruler heatmap: whichever author git blame
 * attributes a line to gets that author's stable color, no weighting or decay — git blame already
 * attributes exactly one author per line, so there's no ambiguity to resolve here. Uncommitted
 * lines are omitted; they have no settled author yet.
 */
export function computeLineColors(blameLines: BlameLine[]): LineOwnership[] {
  return blameLines
    .filter((entry) => !entry.isUncommitted)
    .map((entry) => ({
      line: entry.line,
      colorIndex: hashToIndex(entry.authorEmail, CHART_THEME_COLOR_IDS.length),
    }));
}

interface Accumulator {
  author: string;
  authorEmail: string;
  lineCount: number;
  score: number;
  lastActiveSeconds: number;
}

/**
 * Aggregates committed blame lines into per-author recency-weighted ownership, for the
 * `gitLore.showFileOwnership` command's ranking. Each line's contribution to its author's score
 * decays exponentially by the age of the commit that touched it — a line touched yesterday counts
 * far more than one untouched for years, but old lines still count for something, not zero.
 * Uncommitted lines are excluded (no settled author yet). Returns authors sorted
 * most-recently-active first. This has no effect on `computeLineColors`'s per-line color, which
 * stays a direct, unweighted blame lookup.
 */
export function computeOwnership(blameLines: BlameLine[], now: Date): AuthorOwnership[] {
  const committed = blameLines.filter((entry) => !entry.isUncommitted);
  if (committed.length === 0) {
    return [];
  }

  const byEmail = new Map<string, Accumulator>();
  for (const entry of committed) {
    const ageDays = (now.getTime() / 1000 - entry.authorTime) / 86_400;
    const weight = decayWeight(ageDays);
    const existing = byEmail.get(entry.authorEmail);
    if (existing) {
      existing.lineCount += 1;
      existing.score += weight;
      existing.lastActiveSeconds = Math.max(existing.lastActiveSeconds, entry.authorTime);
    } else {
      byEmail.set(entry.authorEmail, {
        author: entry.author,
        authorEmail: entry.authorEmail,
        lineCount: 1,
        score: weight,
        lastActiveSeconds: entry.authorTime,
      });
    }
  }

  const totalScore = Array.from(byEmail.values()).reduce((sum, acc) => sum + acc.score, 0);

  return Array.from(byEmail.values())
    .map((acc) => ({
      author: acc.author,
      authorEmail: acc.authorEmail,
      lineCount: acc.lineCount,
      percentage: totalScore > 0 ? (acc.score / totalScore) * 100 : 0,
      lastActive: new Date(acc.lastActiveSeconds * 1000),
    }))
    .sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test test/unit/core/git/ownership.test.ts`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: passes clean.

- [ ] **Step 6: Stage the changes**

```bash
git add src/core/git/ownership.ts test/unit/core/git/ownership.test.ts
```

Do not commit.

---

### Task 3: Settings and constants

**Files:**
- Modify: `src/constants.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `CONFIG.ownershipEnabled` (string value `'ownership.enabled'`), `COMMANDS.showFileOwnership` (string value `'gitLore.showFileOwnership'`) — both consumed by Task 4 and Task 5.

- [ ] **Step 1: Add the config key and command id to `src/constants.ts`**

In `src/constants.ts`, the current `COMMANDS` object is:

```ts
export const COMMANDS = {
  toggleBlame: 'gitLore.toggleBlame',
  showFileHistory: 'gitLore.showFileHistory',
  showCommit: 'gitLore.showCommit',
  copySha: 'gitLore.copySha',
  openGraph: 'gitLore.openGraph',
  compareBranches: 'gitLore.compareBranches',
  explainCommit: 'gitLore.explainCommit',
  explainLine: 'gitLore.explainLine',
} as const;
```

Add `showFileOwnership`:

```ts
export const COMMANDS = {
  toggleBlame: 'gitLore.toggleBlame',
  showFileHistory: 'gitLore.showFileHistory',
  showCommit: 'gitLore.showCommit',
  copySha: 'gitLore.copySha',
  openGraph: 'gitLore.openGraph',
  compareBranches: 'gitLore.compareBranches',
  explainCommit: 'gitLore.explainCommit',
  explainLine: 'gitLore.explainLine',
  showFileOwnership: 'gitLore.showFileOwnership',
} as const;
```

The current `CONFIG` object is:

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

Add `ownershipEnabled`:

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
  ownershipEnabled: 'ownership.enabled',
  issueLinkingEnabled: 'issueLinking.enabled',
  issueLinkingPattern: 'issueLinking.pattern',
  issueLinkingUrlTemplate: 'issueLinking.urlTemplate',
  aiEnabled: 'ai.enabled',
  aiModelFamily: 'ai.modelFamily',
  aiMaxDiffChars: 'ai.maxDiffChars',
} as const;
```

- [ ] **Step 2: Add the command and the setting to `package.json`**

In `package.json`'s `contributes.commands` array, add a new entry after `gitLore.explainLine`:

```json
    {
      "command": "gitLore.showFileOwnership",
      "title": "GitLore: Show File Ownership",
      "icon": "$(person)"
    }
```

In `contributes.configuration.properties`, add a new property after `gitLore.staleThresholdDays` and before `gitLore.issueLinking.enabled`:

```json
    "gitLore.ownership.enabled": {
      "type": "boolean",
      "default": false,
      "description": "Show a color mark per line in the editor's overview ruler for that line's author. A more opinionated visual than inline blame, so it's off by default."
    },
```

- [ ] **Step 3: Verify the manifest is valid JSON, the project type-checks, and the command shows up correctly**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('valid json')"`
Expected: prints `valid json`

Run: `npm run lint`
Expected: passes clean.

Run: `npx tsx --test test/unit/contributions.test.ts`
Expected: PASS — `gitLore.showFileOwnership` satisfies the existing "every COMMANDS entry that is user-invocable is declared" and "titles are namespaced" checks automatically, since it's declared with a `GitLore: ` prefix. No new test needed in this file for this task.

- [ ] **Step 4: Stage the changes**

```bash
git add src/constants.ts package.json
```

Do not commit.

---

### Task 4: OwnershipDecorationProvider (the ruler heatmap)

**Files:**
- Create: `src/providers/OwnershipDecorationProvider.ts`
- Modify: `src/extension.ts`
- Modify: `test/fixtures/build-fixture-repo.ts`
- Create: `test/integration/ownership.test.ts`

**Interfaces:**
- Consumes: `computeLineColors` from `src/core/git/ownership.ts` (Task 2); `chartThemeColorIdForIndex`, `CHART_THEME_COLOR_IDS` from `src/utils/colors.ts` (Task 1); `CONFIG.ownershipEnabled`, `CONFIG.maxBlameFileSize`, `CONFIG.blameIgnoreWhitespace` from `src/constants.ts` (Task 3 + existing); `BlameSource` (existing) — `getBlameLines(filePath: string, opts: BlameOptions): Promise<BlameLine[] | null>` and `onInvalidate(listener: (repoRoot: string) => void): vscode.Disposable`.
- Produces: `export class OwnershipDecorationProvider implements vscode.Disposable` — constructed with `new OwnershipDecorationProvider(blameSource)`; test hook `getOwnershipRangesForTest(uri: vscode.Uri): number[][]` (index = color index into `CHART_THEME_COLOR_IDS`, value = the 0-based line numbers currently marked with that color).

#### Part A — the provider

- [ ] **Step 1: Write `src/providers/OwnershipDecorationProvider.ts`**

```ts
import * as vscode from 'vscode';
import { CONFIG, DEFAULT_MAX_BLAME_FILE_SIZE } from '../constants';
import { computeLineColors } from '../core/git/ownership';
import { CHART_THEME_COLOR_IDS, chartThemeColorIdForIndex } from '../utils/colors';
import type { BlameSource } from './BlameSource';

/**
 * Paints a color mark per line in the editor's overview ruler, colored by that line's blame
 * author — the "heatmap" from GitLore's roadmap. One decoration type per palette color is
 * required: `overviewRulerColor` is fixed per decoration *type*, not settable per-range, so
 * showing N colors needs N types, each given its own subset of line ranges.
 *
 * Does not set up its own file-system watcher for the active file (unlike
 * `BlameDecorationProvider`) — it relies on `BlameSource`'s `onInvalidate` broadcast, which
 * `BlameDecorationProvider` already arranges to fire on file save (via its own `watchFile` call)
 * whenever it exists, which it unconditionally does in `extension.ts`. This is an explicit,
 * documented reliance, not an accidental one.
 */
export class OwnershipDecorationProvider implements vscode.Disposable {
  private readonly decorationTypes: vscode.TextEditorDecorationType[];
  private readonly disposables: vscode.Disposable[] = [];
  private lastRangesByUri = new Map<string, number[][]>();
  private enabled: boolean;

  constructor(private readonly source: BlameSource) {
    this.decorationTypes = CHART_THEME_COLOR_IDS.map((_, index) =>
      vscode.window.createTextEditorDecorationType({
        overviewRulerColor: new vscode.ThemeColor(chartThemeColorIdForIndex(index)),
        overviewRulerLane: vscode.OverviewRulerLane.Full,
      }),
    );
    this.enabled = this.getConfig<boolean>(CONFIG.ownershipEnabled, false);

    this.disposables.push(
      ...this.decorationTypes,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.updateForEditor(editor);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration(CONFIG.section)) {
          return;
        }
        this.enabled = this.getConfig<boolean>(CONFIG.ownershipEnabled, false);
        void this.updateForEditor(vscode.window.activeTextEditor);
      }),
      this.source.onInvalidate(() => {
        void this.updateForEditor(vscode.window.activeTextEditor);
      }),
    );

    void this.updateForEditor(vscode.window.activeTextEditor);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async updateForEditor(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor) {
      return;
    }
    if (!this.enabled || editor.document.uri.scheme !== 'file') {
      this.clearDecorations(editor);
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const maxSize = this.getConfig<number>(CONFIG.maxBlameFileSize, DEFAULT_MAX_BLAME_FILE_SIZE);
    if (Buffer.byteLength(editor.document.getText(), 'utf8') > maxSize) {
      this.clearDecorations(editor);
      return;
    }

    const ignoreWhitespace = this.getConfig<boolean>(CONFIG.blameIgnoreWhitespace, true);
    const blameLines = await this.source.getBlameLines(filePath, { ignoreWhitespace });
    if (!blameLines) {
      this.clearDecorations(editor);
      return;
    }

    const linesByColorIndex: number[][] = this.decorationTypes.map(() => []);
    for (const { line, colorIndex } of computeLineColors(blameLines)) {
      linesByColorIndex[colorIndex]?.push(line);
    }

    this.decorationTypes.forEach((type, index) => {
      const ranges = (linesByColorIndex[index] ?? []).map((line) => new vscode.Range(line, 0, line, 0));
      editor.setDecorations(type, ranges);
    });
    this.lastRangesByUri.set(editor.document.uri.toString(), linesByColorIndex);
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    for (const type of this.decorationTypes) {
      editor.setDecorations(type, []);
    }
    this.lastRangesByUri.set(editor.document.uri.toString(), []);
  }

  /** Test-only introspection seam — VS Code's public API doesn't expose applied decorations. Index = color index into `CHART_THEME_COLOR_IDS`; value = the 0-based line numbers marked with that color. */
  getOwnershipRangesForTest(uri: vscode.Uri): number[][] {
    return this.lastRangesByUri.get(uri.toString()) ?? [];
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
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
import { OwnershipDecorationProvider } from './providers/OwnershipDecorationProvider';
```

2. After the line `const staleCodeLensProvider = new StaleCodeLensProvider(blameSource);`, add:

```ts
  const ownershipProvider = new OwnershipDecorationProvider(blameSource);
```

3. In the `ctx.subscriptions.push(...)` call, add `ownershipProvider` (it's a `Disposable`, same pattern as `staleCodeLensProvider`):

```ts
  ctx.subscriptions.push(
    blameSource,
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    staleCodeLensProvider,
    ownershipProvider,
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

4. Add `ownershipProvider: OwnershipDecorationProvider;` to the `GitLoreTestApi` interface (after `statusBarProvider: StatusBarProvider;`), and add `ownershipProvider,` to the object returned from `activate()` (after `statusBarProvider,`).

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: passes clean.

#### Part C — fixture repo for integration tests

- [ ] **Step 5: Add `buildOwnershipFixtureRepo` to `test/fixtures/build-fixture-repo.ts`**

A new, separate fixture builder (its own isolated temp repo, matching the existing `buildBranchFixtureRepo`/`buildStaleFixtureRepo` pattern) — one file, two authors, at two known, fixed dates 31 days apart (the exact gap doesn't matter to the math beyond "not zero"; what matters is that the math in Task 2's "recency outweighs raw line count" test and this task's integration test both rely on Bob's commit being *more recent* than Alice's, regardless of how much time has passed by the time either test actually runs — the ratio between two fixed, fully-in-the-past dates never changes).

Append this to the end of `test/fixtures/build-fixture-repo.ts`:

```ts
export interface OwnershipFixtureManifest {
  repoRoot: string;
  trackedFile: string;
}

/**
 * One file, two authors: Alice writes both lines first (older commit), Bob adds a third line
 * later (newer commit) — gives the ownership tests a real recency-vs-line-count tension (Alice
 * has more raw lines, Bob's line is more recent) without needing an injectable "now".
 */
export function buildOwnershipFixtureRepo(): OwnershipFixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-ownership-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const trackedFile = join(repoRoot, 'ownership.txt');
  writeFileSync(trackedFile, 'alice line one\nalice line two\n');
  git(repoRoot, ['add', 'ownership.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'alice adds two lines'], commitEnv('Alice Dev', 'alice@example.com', '2024-01-01T10:00:00'));

  writeFileSync(trackedFile, 'alice line one\nalice line two\nbob line three\n');
  git(repoRoot, ['add', 'ownership.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'bob adds a line'], commitEnv('Bob Smith', 'bob@example.com', '2024-02-01T10:00:00'));

  return { repoRoot, trackedFile };
}
```

#### Part D — integration test

- [ ] **Step 6: Write `test/integration/ownership.test.ts`**

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { buildOwnershipFixtureRepo, type OwnershipFixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { EXTENSION_ID } from './extensionId';

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite('Ownership heatmap decoration', () => {
  let manifest: OwnershipFixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = buildOwnershipFixtureRepo();
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('lines from the same author land in the same color bucket; a different author lands in a different one', async () => {
    const config = vscode.workspace.getConfiguration('gitLore');
    await config.update('ownership.enabled', true, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
      await vscode.window.showTextDocument(doc);

      await waitFor(() => api.ownershipProvider.getOwnershipRangesForTest(doc.uri).some((lines) => lines.length > 0));

      const buckets = api.ownershipProvider.getOwnershipRangesForTest(doc.uri);
      const bucketOf = (line: number): number => buckets.findIndex((lines) => lines.includes(line));

      assert.equal(bucketOf(0), bucketOf(1)); // both Alice's lines
      assert.notEqual(bucketOf(0), bucketOf(2)); // Bob's line differs
      assert.notEqual(bucketOf(2), -1, 'expected line 2 (Bob\'s) to be in some color bucket');
    } finally {
      await config.update('ownership.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('gitLore.ownership.enabled = false (the default) means no ruler marks at all', async () => {
    const doc = await vscode.workspace.openTextDocument(manifest.trackedFile);
    await vscode.window.showTextDocument(doc);
    const buckets = api.ownershipProvider.getOwnershipRangesForTest(doc.uri);
    assert.ok(buckets.every((lines) => lines.length === 0));
  });
});
```

- [ ] **Step 7: Run the full test suite**

Run: `npm run test:unit`
Expected: PASS — all existing unit tests plus Task 1's 5 and Task 2's 10 new tests green.

Run: `npm run test:integration`
Expected: PASS — all existing integration suites plus the 2 new tests in `ownership.test.ts` green.

- [ ] **Step 8: Stage the changes**

```bash
git add src/providers/OwnershipDecorationProvider.ts src/extension.ts test/fixtures/build-fixture-repo.ts test/integration/ownership.test.ts
```

Do not commit.

---

### Task 5: `gitLore.showFileOwnership` command (the legend)

**Files:**
- Create: `src/commands/ownershipCommands.ts`
- Modify: `src/extension.ts`
- Test: `test/integration/ownership.test.ts`

**Interfaces:**
- Consumes: `computeOwnership` from `src/core/git/ownership.ts` (Task 2); `COMMANDS.showFileOwnership`, `CONFIG.maxBlameFileSize`, `CONFIG.blameIgnoreWhitespace`, `CONFIG.section` from `src/constants.ts` (Task 3 + existing); `BlameSource.getBlameLines` (existing); the `OwnershipFixtureManifest`/`buildOwnershipFixtureRepo` fixture (Task 4, already exists by this point).
- Produces: `export async function buildOwnershipQuickPickItems(source: BlameSource, filePath: string, now?: Date): Promise<vscode.QuickPickItem[] | null>` and `export function handleShowFileOwnershipCommand(source: BlameSource): vscode.Disposable`.

- [ ] **Step 1: Write `src/commands/ownershipCommands.ts`**

```ts
import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import { COMMANDS, CONFIG, DEFAULT_MAX_BLAME_FILE_SIZE } from '../constants';
import { computeOwnership } from '../core/git/ownership';
import { formatAge } from '../utils/date';
import type { BlameSource } from '../providers/BlameSource';

/**
 * Builds the QuickPick items for a file's ownership breakdown, or `null` when there's no blame
 * data at all (not a git repo, no commits, or the file exceeds `gitLore.maxBlameFileSize`) — the
 * caller shows an informational message in that case rather than an empty picker. Exported
 * standalone so it's directly testable without driving the real interactive picker UI.
 */
export async function buildOwnershipQuickPickItems(
  source: BlameSource,
  filePath: string,
  now: Date = new Date(),
): Promise<vscode.QuickPickItem[] | null> {
  const config = vscode.workspace.getConfiguration(CONFIG.section);
  const maxSize = config.get<number>(CONFIG.maxBlameFileSize, DEFAULT_MAX_BLAME_FILE_SIZE);

  try {
    const stat = await fs.stat(filePath);
    if (stat.size > maxSize) {
      return null;
    }
  } catch {
    return null;
  }

  const ignoreWhitespace = config.get<boolean>(CONFIG.blameIgnoreWhitespace, true);
  const blameLines = await source.getBlameLines(filePath, { ignoreWhitespace });
  if (!blameLines || blameLines.length === 0) {
    return null;
  }

  const ownership = computeOwnership(blameLines, now);
  if (ownership.length === 0) {
    return null;
  }

  return ownership.map((entry) => ({
    label: entry.author,
    description: `${Math.round(entry.percentage)}%`,
    detail: `${entry.lineCount} ${entry.lineCount === 1 ? 'line' : 'lines'} · last active ${formatAge(entry.lastActive, now)}`,
  }));
}

export function handleShowFileOwnershipCommand(source: BlameSource): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.showFileOwnership, async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      void vscode.window.showInformationMessage('GitLore: open a file to see its ownership breakdown.');
      return;
    }
    const items = await buildOwnershipQuickPickItems(source, editor.document.uri.fsPath);
    if (!items) {
      void vscode.window.showInformationMessage('GitLore: no blame data for this file.');
      return;
    }
    await vscode.window.showQuickPick(items, {
      placeHolder: 'File ownership, weighted by recency',
    });
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: passes clean.

- [ ] **Step 3: Wire the command into `extension.ts`**

In `src/extension.ts`:

1. Add the import, alongside the other command imports:

```ts
import { handleShowFileOwnershipCommand } from './commands/ownershipCommands';
```

2. In the `ctx.subscriptions.push(...)` call, add `handleShowFileOwnershipCommand(blameSource)` after `handleExplainLineCommand(lineExplanationService),`:

```ts
    handleExplainLineCommand(lineExplanationService),
    handleShowFileOwnershipCommand(blameSource),
```

3. Add `getOwnershipItemsForTest: (filePath: string) => buildOwnershipQuickPickItems(blameSource, filePath),` to the object returned from `activate()`, after `getLineExplanationStateForTest: ...,`. Add the matching field to the `GitLoreTestApi` interface: `getOwnershipItemsForTest: (filePath: string) => Promise<vscode.QuickPickItem[] | null>;`, and import `buildOwnershipQuickPickItems` from `./commands/ownershipCommands` alongside the `handleShowFileOwnershipCommand` import (same line, both named imports from the same module).

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: passes clean.

- [ ] **Step 5: Add the QuickPick-items tests to `test/integration/ownership.test.ts`**

Add these two tests inside the existing `suite('Ownership heatmap decoration', ...)` block (rename the suite to `'Ownership heatmap'` since it now covers both the ruler and the command — change the `suite(...)` line's string from `'Ownership heatmap decoration'` to `'Ownership heatmap'`):

```ts
test('gitLore.showFileOwnership: lists authors most-recently-active first, with recency-weighted percentages', async () => {
  const items = await api.getOwnershipItemsForTest(manifest.trackedFile);
  assert.ok(items);
  assert.equal(items.length, 2);

  assert.equal(items[0]?.label, 'Bob Smith'); // more recent commit — listed first
  assert.equal(items[1]?.label, 'Alice Dev');

  const bobPercentage = Number((items[0]?.description ?? '0%').replace('%', ''));
  const alicePercentage = Number((items[1]?.description ?? '0%').replace('%', ''));
  // Alice has 2 of 3 raw lines (66.7%) but her commit is older; Bob has 1 of 3 (33.3%) but is
  // more recent. Recency-weighting must pull Bob's share above his raw line count and Alice's
  // below hers — proving the ranking isn't just counting lines.
  assert.ok(bobPercentage > 34, `expected Bob's recency-weighted share (${bobPercentage}%) above his raw 33.3% line share`);
  assert.ok(alicePercentage < 66, `expected Alice's recency-weighted share (${alicePercentage}%) below her raw 66.7% line share`);
});

test('gitLore.showFileOwnership: returns null for a file with no blame data', async () => {
  const items = await api.getOwnershipItemsForTest('/no/such/file.txt');
  assert.equal(items, null);
});
```

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:unit`
Expected: PASS — no changes to unit test count in this task (Task 5 has no new unit tests; `computeOwnership`'s own math was already covered in Task 2).

Run: `npm run test:integration`
Expected: PASS — all existing integration suites plus the now-4-test `ownership.test.ts` (2 from Task 4, 2 new here) green.

Run: `npm run lint`
Expected: passes clean.

- [ ] **Step 7: Stage the changes**

```bash
git add src/commands/ownershipCommands.ts src/extension.ts test/integration/ownership.test.ts
```

Do not commit.

---

## Verification (whole feature)

- [ ] `npm run lint` passes clean (ESLint + `tsc --noEmit`).
- [ ] `npm run test:unit` passes clean, including all new tests from Tasks 1 and 2.
- [ ] `npm run test:integration` passes clean, including all new tests from Tasks 4 and 5.
- [ ] Manual check in the Extension Development Host (F5): open a file in this repo, turn on `gitLore.ownership.enabled` in Settings, confirm colored marks appear in the overview ruler. Run `GitLore: Show File Ownership` from the command palette and confirm the list shows real author names/percentages/ages for the open file. Run it with no editor open and confirm the informational message appears instead of an error.
- [ ] `CHANGELOG.md`'s `## [Unreleased]` section updated with a short entry for this feature (this closes out Phase 2 of the roadmap — CLAUDE.md §7 — so it's worth noting that in the entry too).
