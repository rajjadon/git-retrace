import type { BlameLine } from '../core/git/types';
import { formatAge, formatAbsolute } from './date';

export interface BlameFormatContext {
  author: string;
  /** Pre-computed relative age string, e.g. "3 days ago" — see utils/date.ts formatAge. */
  age: string;
  /** Pre-computed absolute date string — see utils/date.ts formatAbsolute. */
  date: string;
  message: string;
  sha: string;
}

const TOKEN_RE = /\{(author|age|date|message|sha)\}/g;

/** Substitutes `{author} {age} {date} {message} {sha}` tokens in the `blame.format` template. Unknown tokens pass through unchanged. */
export function formatBlameLabel(template: string, ctx: BlameFormatContext): string {
  return template.replace(TOKEN_RE, (_match, token: keyof BlameFormatContext) => ctx[token]);
}

/** Formats a BlameLine per the `blame.format` template — shared by the inline decoration and the status bar so both render identically. */
export function formatBlameEntry(entry: BlameLine, template: string, now?: Date): string {
  const date = new Date(entry.authorTime * 1000);
  return formatBlameLabel(template, {
    author: entry.isUncommitted ? 'You' : entry.author,
    age: entry.isUncommitted ? 'uncommitted' : formatAge(date, now),
    date: formatAbsolute(date, 'yyyy-MM-dd'),
    message: entry.summary,
    sha: entry.sha.slice(0, 7),
  });
}
