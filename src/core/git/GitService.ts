import { dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import { parseBlamePorcelain, parseNumstat } from './parsers';
import type { BlameLine, FileChange } from './types';
import { GitCommandError, type GitLogger } from './errors';
import { toRepoRelativePath } from '../../utils/path';

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

  /** Resolves the repo root for a file, searching upward from its directory. Null if not in a repo. */
  async getRepoRoot(filePath: string): Promise<string | null> {
    const dir = dirname(this.toCanonicalPath(filePath));
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

  private gitFor(repoRoot: string): SimpleGit {
    let git = this.gitByRoot.get(repoRoot);
    if (!git) {
      git = simpleGit({ baseDir: repoRoot });
      this.gitByRoot.set(repoRoot, git);
    }
    return git;
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
