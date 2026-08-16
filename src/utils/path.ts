import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';

/**
 * `git rev-parse --show-toplevel` resolves symlinks in the path it's given (e.g. macOS's
 * `/var/folders` → `/private/var/folders`), but editor-supplied paths often don't. Comparing them
 * raw silently produces a bogus relative path — canonicalizing both sides here means every caller
 * gets this for free instead of needing to remember it.
 */
function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Converts an absolute file path to a repo-relative path with forward slashes, for stable cache keys and git args. */
export function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return relative(canonicalize(repoRoot), canonicalize(filePath)).split(sep).join('/');
}

/** Builds the LRU cache key: `${repoRoot}:${filePath}:${ref}`. */
export function buildCacheKey(repoRoot: string, filePath: string, ref: string): string {
  return `${repoRoot}:${toRepoRelativePath(repoRoot, filePath)}:${ref}`;
}
