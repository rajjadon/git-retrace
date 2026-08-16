import type { CoChangedFile, CommitFileList } from './types';

/** Below this coupling ratio, a shared commit or two is coincidence, not a real pattern worth surfacing. */
const MIN_COUPLING = 0.3;
/** Below this many shared commits, even a high ratio is too thin a sample (e.g. 1/1) to trust. */
const MIN_CO_CHANGES = 2;

/**
 * Ranks files that changed alongside `targetFile` within `commits`, by how often they come along
 * (`coChanges / totalCommits` touching `targetFile`) — the same "logical coupling" signal tools
 * like CodeScene surface, computed locally from `git log` instead of a separate analysis service.
 * Pure — no I/O.
 */
export function computeCoChangedFiles(commits: CommitFileList[], targetFile: string, limit = 5): CoChangedFile[] {
  const touchingTarget = commits.filter((c) => c.files.includes(targetFile));
  const totalCommits = touchingTarget.length;
  if (totalCommits === 0) {
    return [];
  }

  const coChangeCounts = new Map<string, number>();
  for (const commit of touchingTarget) {
    for (const file of commit.files) {
      if (file === targetFile) {
        continue;
      }
      coChangeCounts.set(file, (coChangeCounts.get(file) ?? 0) + 1);
    }
  }

  return [...coChangeCounts.entries()]
    .map(([path, coChanges]) => ({ path, coChanges, totalCommits, coupling: coChanges / totalCommits }))
    .filter((f) => f.coChanges >= MIN_CO_CHANGES && f.coupling >= MIN_COUPLING)
    .sort((a, b) => b.coupling - a.coupling || b.coChanges - a.coChanges)
    .slice(0, limit);
}
