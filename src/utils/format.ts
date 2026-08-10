import type { BlameLine, FileChange } from '../core/git/types';
import { formatAge, formatAbsolute } from './date';
import { buildGravatarUrl } from './gravatar';

const MARKDOWN_SPECIAL_RE = /([\\`*_{}[\]()#+\-.!|>~])/g;

/**
 * Escapes markdown syntax characters. `author` and `summary` come from git history, which
 * is attacker-influenced content if the repo isn't trusted — without this, a commit message
 * could inject fake links/emphasis/headings into the rendered hover.
 */
function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL_RE, '\\$1');
}

/**
 * Builds the markdown body for the blame hover card. Pure — the caller wraps the result in
 * a `vscode.MarkdownString`. No `isTrusted` is needed since this never emits a `command:` URI.
 */
export function formatBlameHover(entry: BlameLine, diffStat: FileChange | null, now: Date = new Date()): string {
  if (entry.isUncommitted) {
    return '**Uncommitted changes**\n\nThis line has not been committed yet.';
  }

  const date = new Date(entry.authorTime * 1000);
  const avatarUrl = buildGravatarUrl(entry.authorEmail);
  const author = escapeMarkdown(entry.author);
  const message = escapeMarkdown(entry.summary);
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

  return lines.join('\n');
}
