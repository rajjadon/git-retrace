# Stale-code detector — design

**Status:** Approved for planning
**Roadmap item:** GitLore CLAUDE.md §7, Phase 2 — "Stale-code detector — flag files/functions untouched for > `staleThresholdDays`, shown as a subtle CodeLens"

## Problem

GitLore already answers "who wrote this line and why" via blame decorations, hover, and the AI layer. It doesn't yet answer "is this code actively maintained, or has nobody touched it in ages?" — a signal that helps a developer decide whether to trust, refactor, or double-check a function before building on it.

## Scope (v1)

Per-function detection only. A CodeLens above each stale top-level function/method, computed from git blame data already available in the codebase. File-level staleness (flagging an entire file with no meaningful per-symbol granularity, e.g. plain text/config files) is explicitly out of scope for v1 — it can be a fast-follow if wanted later, but isn't needed to satisfy the roadmap's "subtle CodeLens" framing, and keeps this change reviewable as one vertical slice.

## Symbol detection

GitLore does not implement its own per-language parser. Instead it reuses VS Code's built-in `vscode.executeDocumentSymbolProvider` command, which delegates to whatever language server/extension is already installed for that file's language (TypeScript, Python, Go, etc.). This means:

- Zero new runtime dependencies.
- Works for any language VS Code already understands symbols for.
- Files with no registered symbol provider (plain text, unsupported languages) simply get zero CodeLenses — a silent, correct no-op, not an error.

**Depth:** only two levels are considered:
1. Top-level symbols in the document whose kind is `SymbolKind.Function`.
2. Direct children of a top-level `SymbolKind.Class` symbol whose kind is `Method` or `Constructor`.

**Known limitation:** a top-level `const foo = () => {...}` is reported by TypeScript's/JavaScript's language server as `SymbolKind.Variable`, not `Function` — GitLore does not flag these in v1. Including `Variable` broadly would also flag plain data constants (`export const MAX_ITEMS = 200`) as "stale," which is noise, not signal — a constant that hasn't changed in years is stable, not neglected. Distinguishing "a Variable that's actually a function" from "a Variable that's actual data" isn't reliable across language servers without parsing the free-text `detail` field, which formats differently per language and would break the language-agnostic design. Named function declarations (`function foo() {}`) and class methods — the dominant style for the kind of long-lived, addressable logic this feature targets — are unaffected.

No further recursion — a function nested inside another function is never flagged. This bounds the CodeLens count to roughly "one per named, addressable unit of behavior," matching the roadmap's "subtle" framing.

**Class declarations themselves are never flagged.** A class's own symbol range spans its entire body, including every method — so if a class contained even one recently-touched method, the class's own "most recent touch" would already reflect that, and if nothing in the class changed recently, every one of its methods would *also* independently compute as stale. Flagging both the class line and every method line would double up the same information. Resolution: skip `Class` kind entirely for its own lens; only its direct method/constructor children can be flagged. (A class with fields but no methods therefore never gets a stale marker — an accepted, minor gap; empty data-holder classes changing rarely isn't the case this feature targets.)

## Staleness computation (pure logic)

New file: `src/core/git/staleness.ts`. Zero `vscode` imports, per GitLore's `core/` dependency rule — takes plain data in, returns plain data out, fully unit-testable with fixture `BlameLine[]` arrays and no VS Code host.

```ts
export interface StaleInfo {
  sha: string;
  lastTouched: Date;
  ageDays: number;
}

/**
 * Looks at every blamed line in [startLine, endLine] (inclusive, 0-based) and finds the most
 * recently authored one. Returns null when that line is younger than thresholdDays, or when any
 * line in the range is uncommitted (the symbol is being actively edited right now, which is the
 * opposite of stale), or when there's no blame data for the range at all.
 */
export function findStaleSymbol(
  blameLines: BlameLine[],
  startLine: number,
  endLine: number,
  thresholdDays: number,
  now: Date,
): StaleInfo | null;
```

Logic:
1. Filter `blameLines` to `line >= startLine && line <= endLine`.
2. If empty, return `null` (no blame data — e.g. a symbol reported past the end of what blame covered).
3. If any line has `isUncommitted === true`, return `null` (actively dirty, never stale).
4. Find the line with the maximum `authorTime`.
5. Compute `ageDays = (now.getTime() - lastTouched.getTime()) / 86_400_000`.
6. If `ageDays > thresholdDays`, return `{ sha, lastTouched, ageDays }`; otherwise `null`.

## Rendering & click behavior

New file: `src/providers/CodeLensProvider.ts`, exporting `StaleCodeLensProvider implements vscode.CodeLensProvider`.

- `provideCodeLenses(document)`:
  1. Bail (return `[]`) if `gitLore.staleCode.enabled` is `false`, the document isn't `scheme === 'file'`, or the file exceeds `gitLore.maxBlameFileSize` (same guard already used by `BlameDecorationProvider`).
  2. Fetch blame via the existing shared `BlameSource.getBlameLines(filePath, opts)` — the same cache used by decorations and hover, so no duplicate blame subprocess calls for a file already open.
  3. Run `vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri)`.
  4. Walk the symbols per the depth rule above, call `findStaleSymbol` for each candidate's `range`.
  5. For each stale result, build one `vscode.CodeLens(range, command)` where `range` is `new vscode.Range(symbol.range.start, symbol.range.start)` (zero-width, standard CodeLens convention — VS Code renders it as a line above the symbol regardless) and `command` is:
     ```ts
     {
       title: `Stale · last changed ${formatAge(lastTouched, now)}`,
       command: COMMANDS.showCommit,
       arguments: [filePath, sha],
     }
     ```
     reusing the existing `formatAge` utility from `utils/date.ts` — no new date-formatting code.
- `onDidChangeCodeLenses`: wired to `BlameSource.onInvalidate`, so a commit/branch switch that invalidates blame also refreshes the stale lenses, without polling.

## Settings

Added to `constants.ts`'s `CONFIG` object and `package.json`'s `contributes.configuration`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `gitLore.staleCode.enabled` | boolean | `true` | Show a CodeLens above functions/methods untouched for longer than `staleThresholdDays` |
| `gitLore.staleThresholdDays` | number | `180` | Days before a function is considered stale |

`staleCode.enabled` defaults to `true`, consistent with `blame.enabled`'s precedent — the roadmap's settings table lists `staleThresholdDays` without a separate enabled flag, implying the feature was meant to work out of the box; a toggle is still added for users who want to turn it off, matching the existing pattern for every other on-by-default feature.

## Wiring

`extension.ts`: construct `StaleCodeLensProvider(blameSource)` (the same `BlameSource` instance already shared by `BlameDecorationProvider`/`BlameHoverProvider`) and register it via `vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider)`, deferred inside the existing `setImmediate` block alongside the other providers, pushed into `context.subscriptions`.

## Error handling (per CLAUDE.md §13)

| Situation | Response |
|---|---|
| Not a git repo / blame fails | `BlameSource` already returns `null` silently (logs to output channel) — `provideCodeLenses` returns `[]` |
| No symbol provider for the language | `executeDocumentSymbolProvider` returns `undefined`/`[]` — `provideCodeLenses` returns `[]` |
| File exceeds `maxBlameFileSize` | Skip, same as blame decorations |
| `staleCode.enabled` is `false` | Skip entirely, no computation performed |

## Testing

- **Unit** (`test/unit/core/git/staleness.test.ts`): `findStaleSymbol` — stale/not-stale boundary at exactly `thresholdDays`, uncommitted line anywhere in range suppresses staleness, empty range returns null, picks the single most recent line among several.
- **Unit** (`test/unit/providers/codeLens.test.ts` or similar, testing the symbol-walking logic extracted as a pure function where possible): class-level symbols never get their own lens; only direct method/constructor children of a class do; nested/inner functions are never walked.
- **Integration** (`test/integration/`): registering the provider doesn't throw against a fixture repo; a stale fixture function produces a CodeLens whose command arguments match `[filePath, sha]`.

## Out of scope for this spec

- File-level staleness fallback (noted above as a possible fast-follow).
- Any UI for adjusting `staleThresholdDays` per-file or per-folder — it's a single global setting, matching every other GitLore setting.
- Any AI involvement — this is pure git-log arithmetic, no `vscode.lm` calls.
