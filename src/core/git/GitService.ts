import { dirname } from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  parseBlamePorcelain,
  parseNumstat,
  parseNumstatAll,
  parseLog,
  parseCommitDetail,
  parseGraphLog,
  parseBranches,
  parseRemoteUrl,
  parseStatusPorcelain,
  LOG_FORMAT,
  COMMIT_DETAIL_FORMAT,
  GRAPH_LOG_FORMAT,
  BRANCH_FORMAT,
} from './parsers';
import type {
  BlameLine,
  BranchInfo,
  Commit,
  CommitDetail,
  FileChange,
  GraphCommit,
  RemoteInfo,
  WorkingChanges,
} from './types';
import { GitCommandError, type GitLogger } from './errors';
import { toRepoRelativePath } from '../../utils/path';
import { buildDefaultUrlTemplate } from '../../utils/issueLinks';

export interface BlameOptions {
  ignoreWhitespace?: boolean;
}

/**
 * The only place that touches `simple-git`. Zero `vscode` imports — diagnostics
 * go through the injected `GitLogger` instead, so callers decide how to surface them.
 */
export class GitService {
  private readonly gitByRoot = new Map<string, SimpleGit>();
  // A directory's repo root never changes for the lifetime of the process — safe to memoize
  // indefinitely, and worth it since decoration updates call getRepoRoot on every line move.
  private readonly repoRootByDir = new Map<string, string | null>();
  // Remotes essentially never change mid-session — worth caching since issue linking
  // resolves this on every hover/commit-details render.
  private readonly remoteUrlByRoot = new Map<string, string | null>();

  constructor(private readonly logger?: GitLogger) {}

  async isGitAvailable(): Promise<boolean> {
    try {
      const version = await simpleGit().version();
      return Boolean(version.installed);
    } catch (err) {
      this.logger?.warn(`git availability check failed: ${String(err)}`);
      return false;
    }
  }

  /** Resolves the repo root for a file *or* a directory, searching upward. Null if not in a repo. */
  async getRepoRoot(filePath: string): Promise<string | null> {
    const dir = this.toSearchDir(filePath);
    if (this.repoRootByDir.has(dir)) {
      return this.repoRootByDir.get(dir) ?? null;
    }
    let root: string | null;
    try {
      const git = simpleGit({ baseDir: dir });
      root = (await git.revparse(['--show-toplevel'])).trim();
    } catch {
      // Expected for files outside any git repo — silent, not an error.
      root = null;
    }
    this.repoRootByDir.set(dir, root);
    return root;
  }

  async isTracked(filePath: string): Promise<boolean> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return false;
    }
    try {
      const git = this.gitFor(repoRoot);
      const rel = toRepoRelativePath(repoRoot, this.toCanonicalPath(filePath));
      const out = await git.raw(['ls-files', '--', rel]);
      return out.trim().length > 0;
    } catch (err) {
      this.logger?.warn(`ls-files failed for ${filePath}: ${String(err)}`);
      return false;
    }
  }

  /** Blames the whole file in one call — never shell out per line. */
  async blameFile(filePath: string, opts: BlameOptions = {}): Promise<BlameLine[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    if (!(await this.isTracked(filePath))) {
      return [];
    }

    const git = this.gitFor(repoRoot);
    const rel = toRepoRelativePath(repoRoot, this.toCanonicalPath(filePath));
    const args = ['blame', '--line-porcelain'];
    if (opts.ignoreWhitespace) {
      args.push('-w');
    }
    args.push('--', rel);

    try {
      const raw = await git.raw(args);
      return parseBlamePorcelain(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git blame failed for ${filePath}`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Convenience accessor over `blameFile` for a single line — callers should cache `blameFile` results. */
  async blameLine(filePath: string, line: number, opts: BlameOptions = {}): Promise<BlameLine | null> {
    const lines = await this.blameFile(filePath, opts);
    return lines.find((l) => l.line === line) ?? null;
  }

  /** How much a single file changed in a specific commit — used by the blame hover's diff stat. */
  async getFileDiffStat(filePath: string, sha: string): Promise<FileChange | null> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return null;
    }
    const git = this.gitFor(repoRoot);
    const rel = toRepoRelativePath(repoRoot, this.toCanonicalPath(filePath));
    try {
      const raw = await git.raw(['show', '--numstat', '--format=', sha, '--', rel]);
      return parseNumstat(raw);
    } catch (err) {
      // Non-critical to the hover card — log and omit the stat rather than fail the whole hover.
      this.logger?.warn(`diff stat failed for ${filePath}@${sha}: ${String(err)}`);
      return null;
    }
  }

  /** Every commit that touched this file, newest first. `--follow` tracks the file across renames. */
  async getFileHistory(filePath: string, maxCount: number): Promise<Commit[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    if (!(await this.isTracked(filePath))) {
      return [];
    }

    const git = this.gitFor(repoRoot);
    const rel = toRepoRelativePath(repoRoot, this.toCanonicalPath(filePath));
    const args = ['log', '--follow', '-n', String(maxCount), `--pretty=tformat:${LOG_FORMAT}`, '--', rel];

    try {
      const raw = await git.raw(args);
      return parseLog(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git log failed for ${filePath}`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Full metadata (including the full message body) for one commit — used by the commit details view. */
  async getCommit(filePath: string, sha: string): Promise<CommitDetail | null> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return null;
    }
    const git = this.gitFor(repoRoot);
    const args = ['show', '-s', `--pretty=tformat:${COMMIT_DETAIL_FORMAT}`, sha];
    try {
      const raw = await git.raw(args);
      return parseCommitDetail(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git show failed for ${sha}`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** The whole commit's unified diff, across every file it touched (not scoped to `filePath`). */
  async getCommitDiff(filePath: string, sha: string): Promise<string> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return '';
    }
    const git = this.gitFor(repoRoot);
    const args = ['show', '--format=', sha];
    try {
      return await git.raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git show diff failed for ${sha}`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Every file the commit touched, with insertion/deletion counts — not scoped to `filePath`. */
  async getCommitFiles(filePath: string, sha: string): Promise<FileChange[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    const git = this.gitFor(repoRoot);
    const args = ['show', '--numstat', '--format=', sha];
    try {
      const raw = await git.raw(args);
      return parseNumstatAll(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git show --numstat failed for ${sha}`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /**
   * Repo-wide commit graph, not scoped to `filePath` — that's only used to resolve which repo to
   * query. Walks every ref by default; pass `ref` to walk a single branch instead (the graph
   * view's branch picker).
   */
  async getGraphCommits(filePath: string, maxCount: number, ref?: string): Promise<GraphCommit[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    const git = this.gitFor(repoRoot);
    // --topo-order guarantees a commit's parents are never listed before it — the graph
    // layout algorithm processes newest-first and needs children resolved before parents.
    // `--exclude` must precede the `--all` it filters — refs/stash is a bare ref under refs/,
    // so --all walks it too, cluttering the graph with the stash's own commit + its "index"
    // parent (and a stray "refs/stash" badge). GitLens/GitHub keep stashes out of the main graph.
    const revs = ref ? [ref] : ['--exclude=refs/stash', '--all'];
    // --numstat rides along on this one call so the Changes column costs no extra process;
    // ponytail: output grows with total files touched across maxCount commits, which the
    // maxGraphItems cap bounds. Move to a lazy per-row stat fetch only if that cap has to rise.
    const args = [
      'log',
      ...revs,
      '--topo-order',
      '--numstat',
      '--decorate=full',
      '-n',
      String(maxCount),
      `--pretty=tformat:${GRAPH_LOG_FORMAT}`,
    ];
    try {
      const raw = await git.raw(args);
      return parseGraphLog(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git log ${revs.join(' ')} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Per-status file counts for the working tree, including untracked files. Never throws — a dirty-state badge isn't worth failing the whole graph over. */
  async getWorkingChanges(filePath: string): Promise<WorkingChanges> {
    const empty: WorkingChanges = { added: 0, modified: 0, deleted: 0, total: 0 };
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return empty;
    }
    try {
      const raw = await this.gitFor(repoRoot).raw(['status', '--porcelain']);
      return parseStatusPorcelain(raw);
    } catch (err) {
      this.logger?.warn(`git status failed for ${repoRoot}: ${String(err)}`);
      return empty;
    }
  }

  /**
   * One file's full contents at a given ref, for the "before"/"after" sides of a diff editor.
   * Returns '' when the path doesn't exist at that ref — which is the correct left-hand side for
   * a file the commit added, and also what `<sha>^` resolves to for a root commit.
   */
  async getFileAtRef(filePath: string, ref: string, repoRelativePath: string): Promise<string> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return '';
    }
    try {
      return await this.gitFor(repoRoot).raw(['show', `${ref}:${repoRelativePath}`]);
    } catch {
      // Expected whenever the file is absent at that ref — an empty side, not an error.
      return '';
    }
  }

  /** The `origin` remote parsed into host/owner/repo, or null when there's no recognizable remote. */
  async resolveRemoteInfo(filePath: string): Promise<RemoteInfo | null> {
    const remoteUrl = await this.getRemoteUrl(filePath);
    return remoteUrl ? parseRemoteUrl(remoteUrl) : null;
  }

  /** The name of the currently checked-out branch, or null on a detached HEAD / empty repo. */
  async getCurrentBranch(filePath: string): Promise<string | null> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return null;
    }
    try {
      const name = (await this.gitFor(repoRoot).raw(['symbolic-ref', '--short', 'HEAD'])).trim();
      return name.length > 0 ? name : null;
    } catch {
      // Detached HEAD or an empty repo with no commits — expected, not an error.
      return null;
    }
  }

  /** Every local and remote branch, not scoped to `filePath` — used to resolve which repo to query. */
  async getBranches(filePath: string): Promise<BranchInfo[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    const git = this.gitFor(repoRoot);
    const args = ['for-each-ref', 'refs/heads', 'refs/remotes', `--format=${BRANCH_FORMAT}`];
    try {
      const raw = await git.raw(args);
      return parseBranches(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error('git for-each-ref failed', err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Commits reachable from `to` but not from `from` — e.g. what `compare` has that `base` doesn't. */
  async getCommitsBetween(filePath: string, from: string, to: string): Promise<Commit[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    const git = this.gitFor(repoRoot);
    const args = ['log', `${from}..${to}`, `--pretty=tformat:${LOG_FORMAT}`];
    try {
      const raw = await git.raw(args);
      return parseLog(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git log ${from}..${to} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /**
   * The common ancestor of two refs, or null when they share no history. Needed to open a
   * per-file diff editor that agrees with the `base...compare` diff shown inline: on diverged
   * branches, diffing against `base` itself would also surface base's own commits as differences.
   */
  async getMergeBase(filePath: string, a: string, b: string): Promise<string | null> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return null;
    }
    try {
      const sha = (await this.gitFor(repoRoot).raw(['merge-base', a, b])).trim();
      return sha.length > 0 ? sha : null;
    } catch {
      // Unrelated histories have no merge base — expected, not an error.
      return null;
    }
  }

  /** Unified diff between two refs, against their merge-base (`...`) — matches GitHub/GitLab PR-diff semantics. */
  async getDiffBetweenRefs(filePath: string, base: string, compare: string): Promise<string> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return '';
    }
    const git = this.gitFor(repoRoot);
    const args = ['diff', `${base}...${compare}`];
    try {
      return await git.raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git diff ${base}...${compare} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Files that differ between two refs, against their merge-base (`...`) — matches GitHub/GitLab PR-diff semantics. */
  async getFilesBetweenRefs(filePath: string, base: string, compare: string): Promise<FileChange[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    const git = this.gitFor(repoRoot);
    const args = ['diff', '--numstat', `${base}...${compare}`];
    try {
      const raw = await git.raw(args);
      return parseNumstatAll(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git diff --numstat ${base}...${compare} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** The URL of `remoteName`, e.g. for auto-detecting a GitHub/GitLab host for issue linking. Null if there is none. */
  async getRemoteUrl(filePath: string, remoteName = 'origin'): Promise<string | null> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return null;
    }
    const cacheKey = `${repoRoot}:${remoteName}`;
    if (this.remoteUrlByRoot.has(cacheKey)) {
      return this.remoteUrlByRoot.get(cacheKey) ?? null;
    }
    let url: string | null;
    try {
      const git = this.gitFor(repoRoot);
      url = (await git.raw(['remote', 'get-url', remoteName])).trim() || null;
    } catch {
      // Expected when there's no such remote — silent, not an error.
      url = null;
    }
    this.remoteUrlByRoot.set(cacheKey, url);
    return url;
  }

  /**
   * The `{issue}`-templated URL to use for issue linking: the user's configured template if
   * they set one, otherwise an auto-detected GitHub/GitLab template from the `origin` remote.
   * Null when linking isn't possible (no configured template and no recognizable remote).
   */
  async resolveIssueUrlTemplate(filePath: string, configuredTemplate: string): Promise<string | null> {
    if (configuredTemplate) {
      return configuredTemplate;
    }
    const remoteUrl = await this.getRemoteUrl(filePath);
    if (!remoteUrl) {
      return null;
    }
    const remote = parseRemoteUrl(remoteUrl);
    return remote ? buildDefaultUrlTemplate(remote) : null;
  }

  private gitFor(repoRoot: string): SimpleGit {
    let git = this.gitByRoot.get(repoRoot);
    if (!git) {
      git = simpleGit({ baseDir: repoRoot });
      this.gitByRoot.set(repoRoot, git);
    }
    return git;
  }

  /**
   * The directory to begin the upward repo search from.
   *
   * Callers pass either a file (the active editor) or a directory (the workspace folder, used when
   * no editor is open). Taking `dirname` unconditionally breaks the second case: handed a repo
   * *root*, it searches from the root's parent, so a repo that isn't nested inside another repo
   * resolves to null — and every view silently renders empty instead of erroring.
   */
  private toSearchDir(filePath: string): string {
    const canonical = this.toCanonicalPath(filePath);
    try {
      return statSync(canonical).isDirectory() ? canonical : dirname(canonical);
    } catch {
      // Nonexistent path (unsaved buffer, deleted file) — its parent is still where to look.
      return dirname(canonical);
    }
  }

  /**
   * `git rev-parse --show-toplevel` resolves symlinks in the path it's given (e.g. macOS's
   * `/var/folders` → `/private/var/folders`), but editor-supplied paths often don't. Without
   * canonicalizing here, `path.relative(repoRoot, filePath)` silently produces a bogus path
   * and every git call on that file fails as if it were untracked.
   */
  private toCanonicalPath(filePath: string): string {
    try {
      return realpathSync(filePath);
    } catch {
      return filePath;
    }
  }
}
