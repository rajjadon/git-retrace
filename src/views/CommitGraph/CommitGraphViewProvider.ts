import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { layoutGraph } from '../../core/graph/layout';
import { renderGraphHtml } from './render';
import { escapeHtml } from '../escapeHtml';
import { waitForWebviewView } from '../waitForWebviewView';
import { COMMANDS, CONFIG, MEDIA, VIEWS } from '../../constants';
import type { BlameSource } from '../../providers/BlameSource';

const SYNC_TERMINAL_NAME = 'GitLore: Git Sync';

const DEFAULT_MAX_GRAPH_ITEMS = 200;

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function shellHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none';" /></head><body>${bodyHtml}</body></html>`;
}

/**
 * Any path inside the repo will do — every `GitService` call resolves the repo root from it. The
 * active editor is preferred (correct repo in a multi-root workspace), with the first workspace
 * folder as a fallback so the graph still opens when no editor is showing.
 */
export function resolveRepoContextPath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function readMaxGraphItems(): number {
  return vscode.workspace
    .getConfiguration(CONFIG.section)
    .get<number>(CONFIG.maxGraphItems, DEFAULT_MAX_GRAPH_ITEMS);
}

/** Docks the commit graph in the bottom panel (next to Terminal/Debug Console/Output), instead of taking over an editor tab. */
export class CommitGraphViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;
  private currentRepoRoot: string | undefined;
  /** Ref the graph is scoped to; empty string means every ref (`--all`). */
  private currentRef = '';
  private selectedSha: string | undefined;
  // The cap actually used by the last load — starts at `gitLore.maxGraphItems` and grows each
  // time "Load more" is clicked. A plain refresh (or the HEAD/refs auto-refresh) re-asks with
  // this same cap rather than snapping back to the configured default.
  private currentMaxCount = 0;
  // Guards against a superseded `load()` (e.g. a fast ref-picker change, or an auto-refresh
  // landing mid-flight) overwriting a newer one's rendered HTML with stale data once it resolves.
  private loadGeneration = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitService,
    private readonly blameSource: BlameSource,
  ) {
    // Reuses BlameSource's existing `.git/{HEAD,refs/**}` watcher rather than standing up a
    // second one — a pull, push, checkout, or merge (from this graph's own buttons, a terminal,
    // or any other tool) all show up here the same way blame invalidation already does.
    this.disposables.push(
      this.blameSource.onInvalidate((repoRoot) => {
        if (repoRoot === this.currentRepoRoot) {
          void this.reload();
        }
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  getCurrentHtmlForTest(): string | undefined {
    return this.view?.webview.html;
  }

  private mediaUri(name: string): string {
    return this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    void this.loadForActiveEditor();
  }

  /** Called by the "Open Commit Graph" command — reveals the panel tab and (re)loads from the given file. */
  async show(filePath: string, maxCount: number): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.commitGraph}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, maxCount);
  }

  private async loadForActiveEditor(): Promise<void> {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    await this.load(filePath, readMaxGraphItems());
  }

  private async load(filePath: string, maxCount: number): Promise<void> {
    if (!this.view) {
      return;
    }
    const generation = ++this.loadGeneration;
    this.currentFilePath = filePath;
    this.currentMaxCount = maxCount;
    this.view.webview.html = shellHtml('<p>Loading commit graph…</p>');

    try {
      const repoRoot = await this.git.getRepoRoot(filePath);
      this.currentRepoRoot = repoRoot ?? undefined;
      if (repoRoot) {
        this.blameSource.watchHeadFor(repoRoot);
      }

      // One round of parallel git calls, not a waterfall — the graph log dominates, so the
      // branch list and working-tree status ride alongside it for free.
      const [commits, branches, workingChanges] = await Promise.all([
        this.git.getGraphCommits(filePath, maxCount, this.currentRef || undefined),
        this.git.getBranches(filePath),
        this.git.getWorkingChanges(filePath),
      ]);
      if (generation !== this.loadGeneration || !this.view) {
        return;
      }
      const nodes = layoutGraph(commits);
      // A signal, not a guarantee: `git log -n <cap>` can't distinguish "exactly cap commits
      // total" from "more than cap". "Load more" re-asking with a higher cap resolves either way.
      const hasMore = commits.length > 0 && commits.length === maxCount;
      this.view.webview.html = renderGraphHtml(
        {
          nodes,
          branches,
          workingChanges,
          currentRef: this.currentRef,
          selectedSha: this.selectedSha,
          hasMore,
        },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.commitGraph)],
        },
      );
    } catch (err) {
      if (generation !== this.loadGeneration || !this.view) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitLore: failed to load the commit graph — ${escapeHtml(message)}</p>`);
    }
  }

  /** Called by the "Load more commits" button — re-asks with a higher cap, same file and ref. */
  async loadMore(): Promise<void> {
    if (!this.currentFilePath) {
      return;
    }
    await this.load(this.currentFilePath, this.currentMaxCount + readMaxGraphItems());
  }

  /** Re-asks with whatever cap is currently in effect — preserves a "Load more" expansion instead of snapping back to the configured default. */
  private async reload(): Promise<void> {
    const filePath = this.currentFilePath ?? resolveRepoContextPath();
    if (filePath) {
      await this.load(filePath, this.currentMaxCount || readMaxGraphItems());
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, sha, ref } = message as { type?: unknown; sha?: unknown; ref?: unknown };

    if (type === 'openCommit' && typeof sha === 'string' && this.currentFilePath) {
      // Remembered so a later refresh re-renders with the same row still selected.
      this.selectedSha = sha;
      await vscode.commands.executeCommand(COMMANDS.showCommit, this.currentFilePath, sha);
      return;
    }
    if (type === 'openWorkingChanges') {
      // Staging, stashing and committing already have a first-class home in VS Code — hand off
      // rather than rebuilding the SCM view inside a webview.
      await vscode.commands.executeCommand('workbench.view.scm');
      return;
    }
    if (type === 'setRef' && typeof ref === 'string') {
      this.currentRef = ref;
      // A different scope is a fresh view — starts back at the configured cap rather than
      // carrying over a "Load more" expansion made under the previous ref.
      this.currentMaxCount = readMaxGraphItems();
      await this.reload();
      return;
    }
    if (type === 'refresh') {
      await this.reload();
      return;
    }
    if (type === 'loadMore') {
      await this.loadMore();
      return;
    }
    if ((type === 'pull' || type === 'push') && this.currentRepoRoot) {
      // Runs in a real terminal, not via simple-git — pull/push can need interactive auth (an SSH
      // passphrase, a credential-manager prompt) or land a merge conflict on pull, and a terminal
      // is where the user can actually see and handle either. The graph doesn't need its own
      // "did it finish" tracking either: the HEAD/refs watcher wired in the constructor picks up
      // the result the moment the command actually changes something.
      const terminal =
        vscode.window.terminals.find((t) => t.name === SYNC_TERMINAL_NAME) ??
        vscode.window.createTerminal({ name: SYNC_TERMINAL_NAME, cwd: this.currentRepoRoot });
      terminal.show();
      terminal.sendText(type === 'pull' ? 'git pull' : 'git push');
    }
  }
}
