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
