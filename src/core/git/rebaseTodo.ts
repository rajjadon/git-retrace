/**
 * One line of a `git-rebase-todo` file. `editable` is true for the six commands this editor
 * knows how to reorder and re-label (pick/reword/edit/squash/fixup/drop) — the ones sharing the
 * `<command> <sha> <message>` shape. Everything else (`exec`, `label`, `reset`, `merge`, `break`,
 * or anything this parser doesn't recognize) is kept as a non-editable entry: still part of the
 * sequence, rendered read-only, and always serialized back from its original `raw` text — never
 * dropped, reconstructed, or guessed at. Losing a line here means losing a commit.
 */
export interface RebaseEntry {
  editable: boolean;
  command: string;
  sha: string;
  message: string;
  raw: string;
}

const EDITABLE_COMMANDS: Record<string, string> = {
  p: 'pick',
  pick: 'pick',
  r: 'reword',
  reword: 'reword',
  e: 'edit',
  edit: 'edit',
  s: 'squash',
  squash: 'squash',
  f: 'fixup',
  fixup: 'fixup',
  d: 'drop',
  drop: 'drop',
};

const COMMAND_LINE_RE = /^(\S+)\s+([0-9a-f]{4,40})\s+(.*)$/;

/** Parses a `git-rebase-todo` file into entries, oldest-to-newest as git writes it. Pure — no I/O. */
export function parseRebaseTodo(raw: string): RebaseEntry[] {
  const entries: RebaseEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const match = COMMAND_LINE_RE.exec(trimmed);
    const normalized = match ? EDITABLE_COMMANDS[match[1] ?? ''] : undefined;
    if (match && normalized) {
      entries.push({ editable: true, command: normalized, sha: match[2] ?? '', message: match[3] ?? '', raw: line });
    } else {
      entries.push({ editable: false, command: '', sha: '', message: '', raw: line });
    }
  }
  return entries;
}

/**
 * Reconstructs a `git-rebase-todo` document from entries, in array order (so reordering the array
 * is exactly how the UI reorders commits). Editable entries are rebuilt from their (possibly
 * edited) command/sha/message; non-editable entries are written back verbatim from `raw`, since
 * this parser doesn't understand their internal shape well enough to reconstruct them safely.
 * An empty list serializes to an empty string — git's own documented behavior for that is to
 * abort the rebase cleanly, which is exactly what GitLore's "Abort" action relies on.
 */
export function serializeRebaseTodo(entries: RebaseEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  return entries.map((e) => (e.editable ? `${e.command} ${e.sha} ${e.message}` : e.raw)).join('\n') + '\n';
}
