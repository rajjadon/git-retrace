import { relative, sep } from 'node:path';

/** Converts an absolute file path to a repo-relative path with forward slashes, for stable cache keys and git args. */
export function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return relative(repoRoot, filePath).split(sep).join('/');
}

/** Builds the LRU cache key: `${repoRoot}:${filePath}:${ref}`. */
export function buildCacheKey(repoRoot: string, filePath: string, ref: string): string {
  return `${repoRoot}:${toRepoRelativePath(repoRoot, filePath)}:${ref}`;
}
