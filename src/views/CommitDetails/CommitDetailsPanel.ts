import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderCommitDetailsHtml } from './render';
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

/** Singleton webview panel — showing a different commit reveals and reloads the same panel rather than spawning a new tab. */
export class CommitDetailsPanel implements vscode.Disposable {
  private static current: CommitDetailsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentSha: string | undefined;

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  static getCurrentHtmlForTest(): string | undefined {
    return CommitDetailsPanel.current?.panel.webview.html;
  }

  static async show(extensionUri: vscode.Uri, git: GitService, filePath: string, sha: string): Promise<void> {
    if (!CommitDetailsPanel.current) {
      CommitDetailsPanel.current = new CommitDetailsPanel(extensionUri);
    }
    CommitDetailsPanel.current.panel.reveal(vscode.ViewColumn.Active);
    await CommitDetailsPanel.current.load(git, filePath, sha);
  }

  private constructor(private readonly extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(VIEWS.commitDetails, 'Commit Details', vscode.ViewColumn.Active, {
      enableScripts: true,
      // Nothing here is expensive to rebuild — reload from git on every reveal instead of
      // holding a hidden webview's DOM/JS state in memory (§12 performance budget).
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
    CommitDetailsPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.panel.dispose();
  }

  private async load(git: GitService, filePath: string, sha: string): Promise<void> {
    this.currentSha = sha;
    this.panel.title = `Commit ${sha.slice(0, 7)}`;
    this.panel.webview.html = shellPage('<p>Loading commit…</p>');

    try {
      const [commit, files, diff] = await Promise.all([
        git.getCommit(filePath, sha),
        git.getCommitFiles(filePath, sha),
        git.getCommitDiff(filePath, sha),
      ]);
      if (!commit) {
        this.panel.webview.html = shellPage('<p>GitSense: commit not found.</p>');
        return;
      }

      const styleUri = this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'media', 'commitDetails.css'),
      );
      const editorFontFamily = vscode.workspace
        .getConfiguration('editor')
        .get<string>('fontFamily', 'Menlo, Monaco, monospace');

      this.panel.webview.html = renderCommitDetailsHtml(
        { commit, files, diff },
        {
          nonce: createNonce(),
          cspSource: this.panel.webview.cspSource,
          styleUri: styleUri.toString(),
          editorFontFamily,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.html = shellPage(`<p>GitSense: failed to load commit — ${escapeHtml(message)}</p>`);
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    const isCopySha =
      typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'copySha';
    if (isCopySha && this.currentSha) {
      await vscode.commands.executeCommand(COMMANDS.copySha, this.currentSha);
    }
  }
}
