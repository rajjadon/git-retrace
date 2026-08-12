# Blame Hover Card UX Fixes — Implementation Plan

> **For agentic workers:** Follow TDD (tests first) per the project's global CLAUDE.md. This plan covers context, approach, exact source changes, and a verification checklist — write the tests the checklist describes using this codebase's existing test patterns (read the current test files named below before writing new ones).

**Goal:** Fix three real problems surfaced by live user testing of the blame hover: (1) no visual distinction between GitLore's hover content and other providers' look-alike hovers stacked in the same tooltip (VS Code's native git blame, TypeScript's type hover), (2) a missing `supportThemeIcons` flag that would silently break any icon we add, (3) a UX gap where clicking "Explain this line with AI" gives no feedback beyond an easy-to-miss status-bar spinner, requiring the user to know to manually re-hover to see the result.

**Architecture:** No new files, no new architecture — this tightens four existing files (`format.ts`, `BlameHoverProvider.ts`, `LineExplanationService.ts`, `aiCommands.ts`) that a prior plan in this session already built and shipped. All changes are additive refinements to already-working code, not a redesign.

## Context — why

### Root cause of "two git user info cards" (confirmed with the user)

GitLore's hover (`formatBlameHover` in `src/utils/format.ts`) never renders "X files changed, Y insertions", an "Open on GitHub" link, or a settings gear icon — grep confirms those strings exist nowhere in GitLore's hover code. The user confirmed VS Code's own built-in Git Blame feature (`git.blame.editorDecoration.enabled`) is enabled on their machine. VS Code merges every hover provider's output for the same cursor position into one visual tooltip — this is standard, expected platform behavior GitLore cannot suppress or control. **GitLore's hover is not broken; it just does nothing to visually distinguish itself when stacked next to a look-alike.**

### Root cause of "Explain with AI... not clickable" (confirmed with the user)

The link is real and does work — `isTrusted` is set correctly. What's actually happening: clicking any command link inside a `vscode.Hover` closes that hover immediately (a hard VS Code platform behavior — a `Hover` cannot be updated after being shown, confirmed via [microsoft/vscode#137714](https://github.com/microsoft/vscode/issues/137714), no live-streaming API exists). The generation then runs in the background with only a small, easy-to-miss status-bar spinner (`vscode.window.withProgress` at `ProgressLocation.Window`) as feedback. Nothing tells the user to go re-hover the same line to see the result. This reads as "the link didn't do anything," even though it did.

**Agreed fix direction (discussed and confirmed with the user):** after generation finishes, if the user's cursor is still positioned on the exact line that was explained, automatically re-invoke the hover (`editor.action.showHover`) so the result appears with minimal extra action. If the cursor has moved on (different file, different line, or no active editor), fall back to a quiet, non-actionable notification telling them to hover the line again. This is the closest achievable approximation of "the hover updates" given the platform cannot actually do that.

### Design review findings (dispatched via `frontend-design:frontend-design`, verified against actual VS Code type definitions and a real bundled `codicon.css`, not guessed)

1. **Real bug**: `BlameHoverProvider.ts` sets `markdown.isTrusted` but never sets `markdown.supportThemeIcons = true`. Any `$(icon-name)` syntax added to the markdown today would render as literal text, not an icon. Must fix this alongside adding any icon.
2. Use the codicon `sparkle` (verified real) as GitLore's AI glyph, matching the existing `AI_ICON` sparkle motif already used in the Commit Details webview (`src/views/icons.ts`) — same metaphor, different rendering technique (inline SVG there, codicon glyph here).
3. Keep icon **+ short label**, never icon-only — a bare codicon has no click affordance in a native hover; the link's blue color is the only interactivity signal available. Drop "with AI" from the label since the icon now carries that meaning: `Explain this line`.
4. Give all AI-section states one stable leading `$(sparkle)` anchor so switching states reads as "one feature progressing," not "different content appeared." Replace the `⏳` emoji (confirmed the *only* emoji anywhere in `src/`) with the codicon `loading` plus the `~spin` animation-modifier suffix — the same convention VS Code's own UI and extension samples use for animated status icons (e.g. `$(sync~spin)`).
5. Cap GitLore's hover content with a trailing markdown thematic break (`---`), unconditionally, on every render path — this guarantees a clean seam against whatever renders after it, since VS Code's own inter-provider divider isn't reliable (confirmed missing entirely in one of the three screenshots).
6. Label the diffstat's scope (`$(diff) +N -M in this file`) so it stops reading as contradicting VS Code's native whole-commit stat shown alongside it.
7. Cap the "done" explanation's *rendered* length — today it's unbounded, so a long model response can push the whole hover very tall, burying the compact author/message/date block and worsening the "which section is whose" problem through sheer vertical distance.
8. Current information hierarchy (author → message → age/date/sha → diffstat → AI section, AI section always last regardless of state) is already correct — do not reorder anything.

## Approach

Four files change. No new dependencies, no new settings.

### 1. `src/providers/BlameHoverProvider.ts` — fix the missing flag

Add one line next to the existing `isTrusted` assignment:

```typescript
markdown.isTrusted = { enabledCommands: [COMMANDS.explainLine] };
markdown.supportThemeIcons = true;
```

### 2. `src/utils/format.ts` — icon system + trailing divider + scoped diffstat + truncation

Replace the full file:

```typescript
import type { BlameLine, FileChange } from '../core/git/types';
import { formatAge, formatAbsolute } from './date';
import { buildGravatarUrl } from './gravatar';
import { linkifyIssues, type IssueLinkOptions } from './issueLinks';
import { COMMANDS } from '../constants';
import type { LineExplanationState } from '../core/ai/lineExplanationKey';

const MARKDOWN_SPECIAL_RE = /([\\`*_{}[\]()#+\-.!|>~])/g;
/** Caps the rendered "done" explanation length — nothing else in this file bounds model output, and an unbounded response pushes the whole hover very tall. */
const MAX_EXPLANATION_CHARS = 500;

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

/** `$(sparkle)` matches GitLore's existing AI glyph (see `AI_ICON` in `src/views/icons.ts`) — same metaphor, rendered as a codicon here instead of inline SVG since this is a native hover, not a webview. */
function buildExplainLineLink(filePath: string, sha: string, lineContent: string): string {
  const linkArgs = encodeURIComponent(JSON.stringify([filePath, sha, lineContent]));
  return `[$(sparkle) Explain this line](command:${COMMANDS.explainLine}?${linkArgs})`;
}

/**
 * Renders the line-explanation section of the hover based on its current state. A `Hover` can't
 * be updated after it's returned (no live-streaming API), so "in progress" and "finished" are
 * both just different static renders of whatever `formatBlameHover`'s caller looked up before
 * building this hover — see `LineExplanationService` for the writer side. Every state shares the
 * `$(sparkle)` anchor (link states have it inside the link, non-link states before the text) so
 * switching states reads as one feature progressing, not unrelated content appearing.
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
      return '$(sparkle) $(loading~spin) Generating explanation…';
    case 'done': {
      const truncated =
        state.text.length > MAX_EXPLANATION_CHARS ? `${state.text.slice(0, MAX_EXPLANATION_CHARS)}…` : state.text;
      return `$(sparkle) **Why this line exists**\n\n${escapeMarkdown(truncated)}`;
    }
    case 'noModel':
      return `No language model available. Enable a language model (e.g. GitHub Copilot Chat) to use this feature.\n\n${buildExplainLineLink(filePath, sha, lineContent)}`;
    case 'error':
      return `Failed to generate explanation: ${escapeMarkdown(state.message)}\n\n${buildExplainLineLink(filePath, sha, lineContent)}`;
  }
}

/**
 * Builds the markdown body for the blame hover card. Pure — the caller wraps the result in
 * a `vscode.MarkdownString` and must set both `isTrusted = { enabledCommands: [COMMANDS.explainLine] }`
 * (for the command link to be clickable) and `supportThemeIcons = true` (for `$(sparkle)` etc. to
 * render as icons instead of literal text) — VS Code ignores both by default.
 *
 * Every return path ends with a trailing `---` thematic break. GitLore cannot suppress or control
 * other hover providers (VS Code's own native git blame, TypeScript's type-info hover, etc.) that
 * VS Code may stack in the same tooltip for the same cursor position — the trailing rule is the
 * one thing GitLore's own markdown can do to guarantee a clean visual seam against whatever
 * renders after it, since VS Code's own inter-provider divider isn't reliably present.
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
    return '**Uncommitted changes**\n\nThis line has not been committed yet.\n\n---';
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
    lines.push(`$(diff) +${diffStat.insertions} -${diffStat.deletions} in this file`);
  }

  lines.push('', formatLineExplanation(lineExplanation, filePath, entry.sha, lineContent));
  lines.push('', '---');

  return lines.join('\n');
}
```

### 3. `src/ai/LineExplanationService.ts` — rename the state getter to a general-purpose method

`getStateForTest` becomes `getState` — it's no longer test-only, since `aiCommands.ts` needs to read the final state after `explain()` completes to decide whether to auto-reopen the hover or fall back to a notification. Rename the method and update its doc comment; the method body is unchanged:

```typescript
  /** Reads the current line-explanation state. Used by tests (via `GitLoreTestApi`'s `getLineExplanationStateForTest`) and by `handleExplainLineCommand` itself, to decide whether it's safe to auto-reopen the hover after `explain()` completes. */
  async getState(filePath: string, sha: string, lineContent: string): Promise<LineExplanationState | undefined> {
    const repoRoot = await this.git.getRepoRoot(filePath);
    return this.store.get(buildLineExplanationKey(repoRoot, filePath, sha, lineContent));
  }
```

Nothing else in this file changes — `explain()`'s body, its ordering guarantees (cache capture before overwrite, the try/catch/finally safety net, the pre-git-call `enabled` check), all stay exactly as they are.

**`src/extension.ts`** needs one matching one-line change: `getLineExplanationStateForTest: (filePath, sha, lineContent) => lineExplanationService.getState(filePath, sha, lineContent),` (only the method name called on the right-hand side changes — the `GitLoreTestApi` surface name stays `getLineExplanationStateForTest`, since every existing test already calls it by that name).

### 4. `src/commands/aiCommands.ts` — auto-reopen or notify after generation finishes

Replace `handleExplainLineCommand`'s body (leave `handleExplainCommitCommand` untouched):

```typescript
export function handleExplainLineCommand(service: LineExplanationService): vscode.Disposable {
  return vscode.commands.registerCommand(
    COMMANDS.explainLine,
    async (filePath?: string, sha?: string, lineContent?: string) => {
      if (typeof filePath !== 'string' || typeof sha !== 'string' || typeof lineContent !== 'string') {
        void vscode.window.showInformationMessage('GitLore: pick a line with committed history to explain.');
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'GitLore: explaining line…' },
        async () => {
          const controller = new AbortController();
          await service.explain(filePath, sha, lineContent, controller.signal);
        },
      );

      const state = await service.getState(filePath, sha, lineContent);
      if (state === undefined) {
        // Disabled (already showed its own "AI features are disabled" prompt) or aborted
        // (silent by design) — nothing more to surface.
        return;
      }

      const editor = vscode.window.activeTextEditor;
      const stillOnSameLine =
        editor !== undefined &&
        editor.document.uri.fsPath === filePath &&
        editor.selection.active.line < editor.document.lineCount &&
        editor.document.lineAt(editor.selection.active.line).text.slice(0, 500) === lineContent;

      if (stillOnSameLine) {
        // Closest achievable approximation of "the hover updates" — a vscode.Hover cannot
        // actually be updated in place (no live-streaming API), so this forces a fresh one at
        // the current cursor position, which now reads the state explain() just wrote.
        await vscode.commands.executeCommand('editor.action.showHover');
      } else {
        // Cursor moved (different line, different file, or no active editor) — auto-reopening
        // would show a hover for the wrong position or surprise the user mid-something-else.
        void vscode.window.showInformationMessage('GitLore: line explanation finished — hover the line again to view it.');
      }
    },
  );
}
```

## Reuse of existing utilities

- `MarkdownString.supportThemeIcons` / codicon `$(name)` syntax — existing stable VS Code API, just never turned on for this hover.
- `editor.action.showHover` — existing built-in VS Code command (default keybinding Ctrl+K Ctrl+I), not something GitLore needs to implement.
- The `sparkle` codicon and the `$(icon~spin)` animation convention — both real, pre-existing VS Code conventions, not new patterns invented for this fix.
- `escapeMarkdown` — already exists, reused unchanged for the (now-truncated) explanation text.
- No new settings, no new cache, no new class.

## Edge cases

- **Explanation text shorter than the cap**: no truncation, no trailing `…` — verify the truncation branch only fires when actually over the limit.
- **Cursor still on the same line, but in a *different* editor/split showing the same file**: `vscode.window.activeTextEditor` only reflects the currently *focused* editor group, so a match here is already scoped correctly to "the editor the user is actually looking at."
- **Document shorter than the remembered cursor line** (e.g. user undid changes after clicking): the `editor.selection.active.line < editor.document.lineCount` guard prevents `lineAt` from throwing on an out-of-range line.
- **`noModel`/`error` states reached via the auto-reopen path**: `editor.action.showHover` will show whatever `formatBlameHover` renders for that state (message + retry link) — no special-casing needed, this falls out of reusing the same render function.
- **Uncommitted lines**: still get the trailing `---` — the early-return path was updated too, not just the main path.

## Verification

- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `npm run lint` clean.
- [ ] Update every existing assertion in `test/unit/utils/format.test.ts` that checks for now-changed literal text: the link's old wording (`Explain this line with AI` → `$(sparkle) Explain this line`), the diffstat's old format (`+N -M` → `$(diff) +N -M in this file`), the pending state's old emoji (`⏳` → `$(sparkle) $(loading~spin)`). Read the current file first — every one of the 13 existing tests needs to still pass, several need their assertions updated to match the new exact strings above, none need to be deleted.
- [ ] Add new unit tests for: the trailing `---` divider present on every render path (committed, uncommitted, and each AI state), the "done" state's truncation at `MAX_EXPLANATION_CHARS` (a text under the cap is untouched, a text over it is cut with a trailing `…`), and that the scoped diffstat reads `in this file`.
- [ ] Add an integration test asserting `BlameHoverProvider`'s returned hover has `supportThemeIcons === true` (mirrors the existing `isTrusted` assertion pattern already in `test/integration/hover.test.ts`).
- [ ] Add an integration test for the auto-reopen path: open the tracked file, position the cursor on the exact line being explained (`vscode.window.showTextDocument` + set `editor.selection`), invoke `gitLore.explainLine` with `ai.enabled=true` (deterministic `noModel` outcome in the test host), and confirm — since there's no direct way to assert "a hover was shown" — that `vscode.commands.executeCommand` was actually invoked with `'editor.action.showHover'`. Do this the same way existing tests already stub `vscode.window.showInformationMessage` (wrap the real function, record calls, delegate through or record-and-restore in a `finally`) — do not mock GitLore's own service layer, only this one VS Code API surface.
- [ ] Add an integration test for the notification-fallback path: invoke `gitLore.explainLine` for a line, then move the cursor elsewhere (or don't position it there in the first place) before/without it being on that line, and confirm `showInformationMessage` was called with the "hover the line again" text instead of `editor.action.showHover` being invoked.
- [ ] `npm run test:unit` and `npm run test:integration` both 100% green — this repo is fully green today (236 unit / 41 integration), it must stay that way.
- [ ] Manual sanity check is out of scope for the automated verification (no way to screenshot from a test), but note in the final report that a human should re-test in the Extension Development Host against the same repro that produced the original screenshots, since that's the only way to confirm the *visual* fix (trailing divider, icon rendering, scoped diffstat) actually reads better in practice.
