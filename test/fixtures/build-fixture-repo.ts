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
export const MANIFEST_PATH = join(tmpdir(), 'gitretrace-fixture-manifest.json');

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}

function commitEnv(name: string, email: string, isoDate: string): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  };
}

/**
 * Builds a small, deterministic git repo in a fresh temp directory by running real
 * git commands with pinned author/committer identity and dates. Avoids committing a
 * real `.git` fixture directory (repo-in-repo tooling friction) in favor of building
 * one on demand before the integration suite runs.
 */
export function buildFixtureRepo(): FixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitretrace-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const trackedFile = join(repoRoot, 'tracked.txt');

  writeFileSync(trackedFile, 'line one\nline two\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'first commit'], commitEnv('Raj Jadon', 'raj@example.com', '2024-01-01T10:00:00'));

  writeFileSync(trackedFile, 'line one\nline two\nline three\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'add line three'], commitEnv('Amy Dev', 'amy@example.com', '2024-02-01T10:00:00'));

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

export interface BranchFixtureManifest {
  repoRoot: string;
  trackedFile: string;
  baseBranch: string;
  featureBranch: string;
}

/**
 * A separate, isolated repo (its own temp dir, never touched by other tests) with a feature
 * branch that diverges from `main` — used for branch comparison, where `--all`-scoped commands
 * (like the commit graph) elsewhere must not see this extra branch/commit.
 */
export function buildBranchFixtureRepo(): BranchFixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitretrace-branch-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const trackedFile = join(repoRoot, 'tracked.txt');
  writeFileSync(trackedFile, 'line one\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'base commit'], commitEnv('Raj Jadon', 'raj@example.com', '2024-01-01T10:00:00'));

  git(repoRoot, ['checkout', '-q', '-b', 'feature-x']);
  writeFileSync(trackedFile, 'line one\nfeature line\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'add feature line'], commitEnv('Amy Dev', 'amy@example.com', '2024-01-02T10:00:00'));

  git(repoRoot, ['checkout', '-q', 'main']);

  return { repoRoot, trackedFile, baseBranch: 'main', featureBranch: 'feature-x' };
}
