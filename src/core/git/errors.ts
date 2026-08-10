/** Injected by callers so `core/git` can report diagnostics without importing `vscode`. */
export interface GitLogger {
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

/** Thrown for git failures that are NOT one of the expected/silent states (no repo, untracked, empty repo). */
export class GitCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly stderr: string,
  ) {
    super(stderr || `git command failed: ${command}`);
    this.name = 'GitCommandError';
  }
}
