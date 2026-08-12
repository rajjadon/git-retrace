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
