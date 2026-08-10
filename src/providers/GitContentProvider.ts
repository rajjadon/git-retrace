import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { GitService } from '../core/git/GitService';
import { SCHEMES } from '../constants';

/** Everything needed to resolve one file's bytes at one ref. Serialized into the URI's query. */
interface GitFileRef {
  /** Any path inside the repo — `GitService` resolves the root from it. */
  repoPath: string;
  ref: string;
  /** Repo-relative path, as git spells it. */
  path: string;
}

function parseGitFileRef(query: string): GitFileRef | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const { repoPath, ref, path } = parsed as Partial<Record<keyof GitFileRef, unknown>>;
  if (typeof repoPath !== 'string' || typeof ref !== 'string' || typeof path !== 'string') {
    return null;
  }
  return { repoPath, ref, path };
}

/**
 * A URI the diff editor can open for `path` as it existed at `ref`. The real path goes in the
 * URI's path so VS Code picks the right language for syntax highlighting and shows a recognizable
 * tab label; the resolution details ride in the query.
 */
export function buildGitFileUri(fileRef: GitFileRef): vscode.Uri {
  return vscode.Uri.from({
    scheme: SCHEMES.gitContent,
    path: `/${fileRef.path}`,
    query: JSON.stringify(fileRef),
  });
}

/**
 * Serves one file's contents at one git ref to the diff editor.
 *
 * This exists instead of reusing the built-in Git extension's `git:` scheme because that scheme's
 * query shape is an internal detail of another extension — depending on it would make GitSense
 * break on someone else's refactor.
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly git: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const fileRef = parseGitFileRef(uri.query);
    if (!fileRef) {
      return '';
    }
    return this.git.getFileAtRef(fileRef.repoPath, fileRef.ref, fileRef.path);
  }
}

export interface OpenFileDiffOptions {
  /** Any path inside the repo, used to resolve the repo root. */
  repoPath: string;
  /** Repo-relative path of the file to diff. */
  path: string;
  /** Ref for the left-hand (before) side. */
  beforeRef: string;
  /** Ref for the right-hand (after) side. */
  afterRef: string;
  /** Short label for the diff tab, e.g. a short SHA or `base...compare`. */
  label: string;
}

/**
 * Opens a real diff editor for one file between two refs. Handing off to the editor rather than
 * widening the webview's own diff buys syntax highlighting, folding, go-to-definition and the
 * user's own diff settings — none of which a `<pre>` will ever have.
 */
export async function openFileDiff(opts: OpenFileDiffOptions): Promise<void> {
  const left = buildGitFileUri({ repoPath: opts.repoPath, ref: opts.beforeRef, path: opts.path });
  const right = buildGitFileUri({ repoPath: opts.repoPath, ref: opts.afterRef, path: opts.path });
  await vscode.commands.executeCommand('vscode.diff', left, right, `${basename(opts.path)} (${opts.label})`);
}
