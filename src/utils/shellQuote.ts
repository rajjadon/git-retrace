/**
 * POSIX single-quoting — safe for bash/zsh/fish, the shells GitLore's integrated-terminal commands
 * target. Wraps `value` so a shell treats it as one literal argument no matter what it contains;
 * used whenever repo-controlled content (e.g. a branch name) is interpolated into a real shell
 * command, since it isn't trusted input just because it came from `git`.
 */
export function shellQuotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
