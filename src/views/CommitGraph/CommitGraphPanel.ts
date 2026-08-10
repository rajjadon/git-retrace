import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { layoutGraph } from '../../core/graph/layout';
import { renderGraphHtml } from './render';
import { escapeHtml } from '../escapeHtml';
import { COMMANDS, VIEWS } from '../../constants';

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function shellPage(bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none';" /></head><body>${bodyHtml}</body></html>`;
}

/** Singleton webview panel — reopening the graph reveals and reloads the same panel rather than spawning a new tab. */
export class CommitGraphPanel implements vscode.Disposable {
  private static current: CommitGraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentFilePath: string | undefined;

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  static getCurrentHtmlForTest(): string | undefined {
    return CommitGraphPanel.current?.panel.webview.html;
  }

  static async show(extensionUri: vscode.Uri, git: GitService, filePath: string, maxCount: number): Promise<void> {
    if (!CommitGraphPanel.current) {
      CommitGraphPanel.current = new CommitGraphPanel(extensionUri);
    }
    CommitGraphPanel.current.panel.reveal(vscode.ViewColumn.Active);
    await CommitGraphPanel.current.load(git, filePath, maxCount);
  }

  private constructor(private readonly extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(VIEWS.commitGraph, 'Commit Graph', vscode.ViewColumn.Active, {
      enableScripts: true,
      // Nothing here is expensive to rebuild — reload from git on every reveal (§12 performance budget).
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message);
      }),
    );
  }

  dispose(): void {
    CommitGraphPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.panel.dispose();
  }

  private async load(git: GitService, filePath: string, maxCount: number): Promise<void> {
    this.currentFilePath = filePath;
    this.panel.webview.html = shellPage('<p>Loading commit graph…</p>');

    try {
      const commits = await git.getGraphCommits(filePath, maxCount);
      const nodes = layoutGraph(commits);
      const styleUri = this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'media', 'commitGraph.css'),
      );
      this.panel.webview.html = renderGraphHtml(
        { nodes },
        { nonce: createNonce(), cspSource: this.panel.webview.cspSource, styleUri: styleUri.toString() },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.html = shellPage(`<p>GitSense: failed to load the commit graph — ${escapeHtml(message)}</p>`);
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    const sha =
      typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'openCommit'
        ? (message as { sha?: unknown }).sha
        : undefined;
    if (typeof sha === 'string' && this.currentFilePath) {
      await vscode.commands.executeCommand(COMMANDS.showCommit, this.currentFilePath, sha);
    }
  }
}
