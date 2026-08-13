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
export const MANIFEST_PATH = join(tmpdir(), 'gitlore-fixture-manifest.json');

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
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-fixture-'));
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
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-branch-fixture-'));
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

export interface StaleFixtureManifest {
  repoRoot: string;
  staleFile: string;
  /** SHA of the commit that last touched every symbol except `recentlyChangedFunction`. */
  staleSha: string;
}

const STALE_FILE_CONTENT_V1 = `export function longUnchangedFunction() {
  return 1;
}

export function recentlyChangedFunction() {
  return 2;
}

export class OldService {
  run() {
    return 1;
  }
}

export function outerFunction() {
  function innerHelper() {
    return 1;
  }
  return innerHelper();
}
`;

// Written out in full (not derived from V1 via string surgery) so the two versions stay easy to
// diff by eye and an edit to one can't silently desync from the other.
const STALE_FILE_CONTENT_V2 = `export function longUnchangedFunction() {
  return 1;
}

export function recentlyChangedFunction() {
  return 3;
}

export class OldService {
  run() {
    return 1;
  }
}

export function outerFunction() {
  function innerHelper() {
    return 1;
  }
  return innerHelper();
}
`;

/**
 * A `.ts` fixture (TypeScript's built-in language server provides real document symbols for it,
 * which the plain `tracked.txt` used elsewhere can't) with one old commit touching every symbol,
 * and a second, effectively-"just now" commit that touches only `recentlyChangedFunction` — giving
 * the stale-code-detector tests both a definitely-stale and a definitely-fresh function in one file.
 */
export function buildStaleFixtureRepo(): StaleFixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-stale-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const staleFile = join(repoRoot, 'stale.ts');
  writeFileSync(staleFile, STALE_FILE_CONTENT_V1);
  git(repoRoot, ['add', 'stale.ts']);
  // Far enough in the past to stay well past any plausible staleThresholdDays for decades.
  git(repoRoot, ['commit', '-q', '-m', 'add stale.ts'], commitEnv('Raj Jadon', 'raj@example.com', '2015-01-01T10:00:00'));

  const staleSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

  writeFileSync(staleFile, STALE_FILE_CONTENT_V2);
  git(repoRoot, ['add', 'stale.ts']);
  // Dated "now" (at fixture-build time, which happens immediately before the suite runs) so this
  // function is always fresh relative to the real wall-clock `now` the provider uses internally.
  git(repoRoot, ['commit', '-q', '-m', 'update recentlyChangedFunction'], commitEnv('Amy Dev', 'amy@example.com', new Date().toISOString()));

  return { repoRoot, staleFile, staleSha };
}

export interface OwnershipFixtureManifest {
  repoRoot: string;
  trackedFile: string;
}

/**
 * One file, two authors: Alice writes both lines first (older commit), Bob adds a third line
 * later (newer commit) — gives the ownership tests a real recency-vs-line-count tension (Alice
 * has more raw lines, Bob's line is more recent) without needing an injectable "now".
 */
export function buildOwnershipFixtureRepo(): OwnershipFixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-ownership-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const trackedFile = join(repoRoot, 'ownership.txt');
  writeFileSync(trackedFile, 'alice line one\nalice line two\n');
  git(repoRoot, ['add', 'ownership.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'alice adds two lines'], commitEnv('Alice Dev', 'alice@example.com', '2024-01-01T10:00:00'));

  writeFileSync(trackedFile, 'alice line one\nalice line two\nbob line three\n');
  git(repoRoot, ['add', 'ownership.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'bob adds a line'], commitEnv('Bob Smith', 'bob@example.com', '2024-02-01T10:00:00'));

  return { repoRoot, trackedFile };
}

export interface ExplorerFixtureManifest {
  repoRoot: string;
  trackedFile: string;
  currentBranch: string;
  otherBranch: string;
  tagName: string;
  stashMessage: string;
}

/**
 * A fresh, isolated repo per call (mutating commands — checkout, stash apply/drop — must never
 * touch the one shared workspace repo every other integration suite runs against) with one of
 * everything the Sidebar Explorer lists: two local branches, a tag, and a stash entry.
 */
export function buildExplorerFixtureRepo(): ExplorerFixtureManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-explorer-fixture-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
  git(repoRoot, ['config', 'user.email', 'raj@example.com']);

  const trackedFile = join(repoRoot, 'tracked.txt');
  writeFileSync(trackedFile, 'line one\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'base commit'], commitEnv('Raj Jadon', 'raj@example.com', '2024-01-01T10:00:00'));

  git(repoRoot, ['tag', 'v1.0.0']);

  git(repoRoot, ['checkout', '-q', '-b', 'feature-y']);
  writeFileSync(trackedFile, 'line one\nfeature line\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'add feature line'], commitEnv('Amy Dev', 'amy@example.com', '2024-01-02T10:00:00'));
  git(repoRoot, ['checkout', '-q', 'main']);

  const stashMessage = 'wip explorer test';
  writeFileSync(trackedFile, 'line one\nuncommitted change\n');
  git(repoRoot, ['stash', 'push', '-q', '-m', stashMessage]);

  return { repoRoot, trackedFile, currentBranch: 'main', otherBranch: 'feature-y', tagName: 'v1.0.0', stashMessage };
}
