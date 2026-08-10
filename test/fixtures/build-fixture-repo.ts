import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface FixtureCommit {
  sha: string;
  message: string;
  author: string;
}

export interface FixtureManifest {
  repoRoot: string;
  trackedFile: string;
  untrackedFile: string;
  /** Newest first, matching `git log` order. */
  commits: FixtureCommit[];
}

/** Where runTests.ts writes the manifest so the suite running inside the Extension Development Host can read it back. */
export const MANIFEST_PATH = join(tmpdir(), 'gitsense-fixture-manifest.json');

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}

/**
 * Builds a small, deterministic git repo in a fresh temp directory by running real
 * git commands with pinned author/committer identity and dates. Avoids committing a
 * real `.git` fixture directory (repo-in-repo tooling friction) in favor of building
 * one on demand before the integration suite runs.
 */
export function buildFixtureRepo(): FixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitsense-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const trackedFile = join(repoRoot, 'tracked.txt');

  writeFileSync(trackedFile, 'line one\nline two\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'first commit'], {
    GIT_AUTHOR_NAME: 'Raj Jadon',
    GIT_AUTHOR_EMAIL: 'raj@example.com',
    GIT_COMMITTER_NAME: 'Raj Jadon',
    GIT_COMMITTER_EMAIL: 'raj@example.com',
    GIT_AUTHOR_DATE: '2024-01-01T10:00:00',
    GIT_COMMITTER_DATE: '2024-01-01T10:00:00',
  });

  writeFileSync(trackedFile, 'line one\nline two\nline three\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'add line three'], {
    GIT_AUTHOR_NAME: 'Amy Dev',
    GIT_AUTHOR_EMAIL: 'amy@example.com',
    GIT_COMMITTER_NAME: 'Amy Dev',
    GIT_COMMITTER_EMAIL: 'amy@example.com',
    GIT_AUTHOR_DATE: '2024-02-01T10:00:00',
    GIT_COMMITTER_DATE: '2024-02-01T10:00:00',
  });

  const untrackedFile = join(repoRoot, 'untracked.txt');
  writeFileSync(untrackedFile, 'not tracked\n');

  const log = execFileSync('git', ['log', '--pretty=format:%H|%s|%an'], { cwd: repoRoot }).toString();
  const commits: FixtureCommit[] = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, message, author] = line.split('|');
      return { sha: sha ?? '', message: message ?? '', author: author ?? '' };
    });

  return { repoRoot, trackedFile, untrackedFile, commits };
}
