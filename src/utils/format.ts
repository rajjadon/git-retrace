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

  // A bare `![](url) **name**` paragraph baseline-aligns the image with the text, so the avatar
  // hangs noticeably above the name — confirmed against VS Code's own sanitizer allowlist
  // (github.com/microsoft/vscode markdownRenderer.ts): `img` may not carry `style` or `class`, so
  // there is no markdown/HTML way to set `vertical-align` on it directly. A borderless two-cell
  // table sidesteps this: `td`/`th` default to `vertical-align: middle` in every browser, which
  // centers the avatar against the name regardless of the image's own inline alignment.
  const lines = [
    `| ![](${avatarUrl}) | **${author}** |`,
    '| :--- | :--- |',
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
