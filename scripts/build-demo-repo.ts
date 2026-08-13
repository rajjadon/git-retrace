/**
 * Builds a realistic, purpose-built demo repo for screenshots of features that need real content
 * to look convincing — multiple authors, a wide commit-date spread, and normal-looking source
 * files. `test/fixtures/build-fixture-repo.ts` deliberately optimizes for deterministic *assertions*
 * (tiny files, "alice line one" placeholder text), not visual quality, so it isn't reused here.
 *
 * This repo is what `scripts/shoot-native-screenshots.ts` opens in a real VS Code window.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface DemoRepoManifest {
  repoRoot: string;
  authServiceFile: string;
  userProfileFile: string;
  currentBranch: string;
  featureBranch: string;
  tagName: string;
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}

function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
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

const MAYA = commitEnv.bind(null, 'Maya Chen', 'maya@acmestorefront.dev');
const DIEGO = commitEnv.bind(null, 'Diego Alvarez', 'diego@acmestorefront.dev');
const SAM = commitEnv.bind(null, 'Sam Okafor', 'sam@acmestorefront.dev');

const AUTH_SERVICE_V1 = `export function validateToken(token: string): boolean {
  if (!token) {
    return false;
  }
  return token.length > 20 && token.startsWith('tok_');
}

export function hashPassword(password: string, salt: string): string {
  return \`\${salt}:\${password}\`;
}

export class SessionStore {
  private sessions = new Map<string, string>();

  create(userId: string): string {
    const token = \`tok_\${userId}_\${Date.now()}\`;
    this.sessions.set(token, userId);
    return token;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }
}
`;

const AUTH_SERVICE_V2 = `${AUTH_SERVICE_V1}
export function refreshToken(oldToken: string): string {
  return oldToken.replace('tok_', 'tok2_');
}
`;

const USER_PROFILE_V1 = `export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
}

export function formatDisplayName(profile: UserProfile): string {
  return profile.displayName;
}
`;

const USER_PROFILE_V2 = `export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
}

export function formatDisplayName(profile: UserProfile): string {
  return profile.displayName;
}

export function buildAvatarUrl(profile: UserProfile, size: number): string {
  return \`\${profile.avatarUrl}?s=\${size}\`;
}
`;

const USER_PROFILE_V3 = `export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string;
}

export function formatDisplayName(profile: UserProfile): string {
  return profile.displayName;
}

export function buildAvatarUrl(profile: UserProfile, size: number): string {
  return \`\${profile.avatarUrl}?s=\${size}\`;
}

export function isProfileComplete(profile: UserProfile): boolean {
  return Boolean(profile.displayName && profile.avatarUrl);
}
`;

const USER_PROFILE_V4 = USER_PROFILE_V3.replace(
  'return profile.displayName;',
  'return profile.displayName.trim();',
);

export function buildDemoRepo(): DemoRepoManifest {
  const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-demo-'));
  const srcDir = join(repoRoot, 'src');
  mkdirSync(srcDir);
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Maya Chen']);
  git(repoRoot, ['config', 'user.email', 'maya@acmestorefront.dev']);

  const authServiceFile = join(srcDir, 'authService.ts');
  const userProfileFile = join(srcDir, 'userProfile.ts');

  // authService.ts: everything but refreshToken is genuinely old (well past any staleThresholdDays);
  // refreshToken lands "now" so the stale-code detector has both a stale and a fresh function in one file.
  writeFileSync(authServiceFile, AUTH_SERVICE_V1);
  git(repoRoot, ['add', 'src/authService.ts']);
  git(repoRoot, ['commit', '-q', '-m', 'Add token validation and session storage'], MAYA(daysAgo(420)));

  // userProfile.ts built up over real time by three different authors, for ownership + the
  // full-file-blame recency gradient.
  writeFileSync(userProfileFile, USER_PROFILE_V1);
  git(repoRoot, ['add', 'src/userProfile.ts']);
  git(repoRoot, ['commit', '-q', '-m', 'Add UserProfile type and display-name formatting'], MAYA(daysAgo(410)));

  writeFileSync(userProfileFile, USER_PROFILE_V2);
  git(repoRoot, ['add', 'src/userProfile.ts']);
  git(repoRoot, ['commit', '-q', '-m', 'Add avatar URL helper'], DIEGO(daysAgo(210)));

  writeFileSync(userProfileFile, USER_PROFILE_V3);
  git(repoRoot, ['add', 'src/userProfile.ts']);
  git(repoRoot, ['commit', '-q', '-m', 'Add profile completeness check'], SAM(daysAgo(28)));

  const tagName = 'v2.4.0';
  git(repoRoot, ['tag', tagName]);

  const featureBranch = 'feature/dark-mode-toggle';
  git(repoRoot, ['checkout', '-q', '-b', featureBranch]);
  writeFileSync(join(srcDir, 'themeToggle.ts'), `export function toggleTheme(current: 'light' | 'dark') {\n  return current === 'light' ? 'dark' : 'light';\n}\n`);
  git(repoRoot, ['add', 'src/themeToggle.ts']);
  git(repoRoot, ['commit', '-q', '-m', 'Start dark mode toggle'], DIEGO(daysAgo(3)));
  git(repoRoot, ['checkout', '-q', 'main']);

  writeFileSync(userProfileFile, USER_PROFILE_V4);
  git(repoRoot, ['add', 'src/userProfile.ts']);
  git(repoRoot, ['commit', '-q', '-m', 'Trim whitespace in formatted display names'], MAYA(daysAgo(0)));

  writeFileSync(authServiceFile, AUTH_SERVICE_V2);
  git(repoRoot, ['add', 'src/authService.ts']);
  git(repoRoot, ['commit', '-q', '-m', 'Add token refresh'], SAM(daysAgo(0)));

  git(repoRoot, ['remote', 'add', 'origin', 'https://github.com/acme/storefront.git']);

  // A real, uncommitted change for the Sidebar Explorer's Stashes section.
  writeFileSync(authServiceFile, `${AUTH_SERVICE_V2}\n// TODO: rate-limit refreshToken\n`);
  git(repoRoot, ['stash', 'push', '-q', '-m', 'wip: rate limiting for token refresh']);

  return { repoRoot, authServiceFile, userProfileFile, currentBranch: 'main', featureBranch, tagName };
}

if (require.main === module) {
  const manifest = buildDemoRepo();
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
