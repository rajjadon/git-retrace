import type { RemoteInfo } from '../core/git/types';

export interface IssueLinkSegment {
  text: string;
  /** `null` = plain text, not a link. */
  url: string | null;
}

export interface IssueLinkOptions {
  pattern: string;
  /** `{issue}`-templated URL, e.g. `https://github.com/owner/repo/issues/{issue}`. */
  urlTemplate: string;
}

/**
 * Splits `text` into plain and linked segments using a user-configurable regex. The URL for
 * each match is built from `urlTemplate` by substituting `{issue}` with the match's first
 * capture group (or the whole match, if the pattern has none).
 *
 * Falls back to a single plain-text segment if `pattern` isn't a valid regex — a bad setting
 * value must not break the whole hover/webview it's rendered into.
 */
export function linkifyIssues(text: string, pattern: string, urlTemplate: string): IssueLinkSegment[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    return [{ text, url: null }];
  }

  const segments: IssueLinkSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), url: null });
    }
    const issueId = match[1] ?? match[0];
    segments.push({ text: match[0], url: urlTemplate.replace('{issue}', issueId) });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), url: null });
  }
  return segments.length > 0 ? segments : [{ text, url: null }];
}

/** GitHub-style issue URL by default; GitLab hosts get its `-/issues/` path convention. */
export function buildDefaultUrlTemplate(remote: RemoteInfo): string {
  const path = `${remote.owner}/${remote.repo}`;
  const issuesPath = remote.host.includes('gitlab') ? `${path}/-/issues` : `${path}/issues`;
  return `https://${remote.host}/${issuesPath}/{issue}`;
}
