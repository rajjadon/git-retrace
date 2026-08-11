import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { layoutGraph } from '../../core/graph/layout';
import { renderGraphHtml } from './render';
import { escapeHtml } from '../escapeHtml';
import { waitForWebviewView } from '../waitForWebviewView';
import { COMMANDS, CONFIG, MEDIA, VIEWS } from '../../constants';

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

/** Docks the commit graph in the bottom panel (next to Terminal/Debug Console/Output), matching GitLens's panel layout, instead of taking over an editor tab. */
export class CommitGraphViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;
  /** Ref the graph is scoped to; empty string means every ref (`--all`). */
  private currentRef = '';
  private selectedSha: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitService,
  ) {}

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  getCurrentHtmlForTest(): string | undefined {
    return this.view?.webview.html;
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
    this.currentFilePath = filePath;
    this.view.webview.html = shellHtml('<p>Loading commit graph…</p>');

    try {
      // One round of parallel git calls, not a waterfall — the graph log dominates, so the
      // branch list and working-tree status ride alongside it for free.
      const [commits, branches, workingChanges] = await Promise.all([
        this.git.getGraphCommits(filePath, maxCount, this.currentRef || undefined),
        this.git.getBranches(filePath),
        this.git.getWorkingChanges(filePath),
      ]);
      const nodes = layoutGraph(commits);
      const styleUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', MEDIA.commitGraph));
      this.view.webview.html = renderGraphHtml(
        {
          nodes,
          branches,
          workingChanges,
          currentRef: this.currentRef,
          selectedSha: this.selectedSha,
        },
        { nonce: createNonce(), cspSource: this.view.webview.cspSource, styleUri: styleUri.toString() },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitLore: failed to load the commit graph — ${escapeHtml(message)}</p>`);
    }
  }

  private async reload(): Promise<void> {
    const filePath = this.currentFilePath ?? resolveRepoContextPath();
    if (filePath) {
      await this.load(filePath, readMaxGraphItems());
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
      await this.reload();
      return;
    }
    if (type === 'refresh') {
      await this.reload();
    }
  }
}
