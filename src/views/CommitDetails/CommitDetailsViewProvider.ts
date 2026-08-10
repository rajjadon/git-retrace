import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderCommitDetailsHtml } from './render';
import { escapeHtml } from '../escapeHtml';
import { resolveIssueLinking } from '../../providers/issueLinking';
import { waitForWebviewView } from '../waitForWebviewView';
import { COMMANDS, VIEWS } from '../../constants';

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

/** Docks commit details in the bottom panel (next to Commit Graph), matching GitLens's panel layout, instead of opening a new editor tab per commit. */
export class CommitDetailsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentSha: string | undefined;

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
  }

  /** Called by the "Show Commit Details" command — reveals the panel tab and loads the given commit. */
  async show(filePath: string, sha: string): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.commitDetails}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, sha);
  }

  private async load(filePath: string, sha: string): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentSha = sha;
    this.view.title = `Commit ${sha.slice(0, 7)}`;
    this.view.webview.html = shellHtml('<p>Loading commit…</p>');

    try {
      const [commit, files, diff, issueLinking] = await Promise.all([
        this.git.getCommit(filePath, sha),
        this.git.getCommitFiles(filePath, sha),
        this.git.getCommitDiff(filePath, sha),
        resolveIssueLinking(this.git, filePath),
      ]);
      if (!commit) {
        this.view.webview.html = shellHtml('<p>GitSense: commit not found.</p>');
        return;
      }

      const styleUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'commitDetails.css'));
      const editorFontFamily = vscode.workspace
        .getConfiguration('editor')
        .get<string>('fontFamily', 'Menlo, Monaco, monospace');

      this.view.webview.html = renderCommitDetailsHtml(
        { commit, files, diff },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUri: styleUri.toString(),
          editorFontFamily,
          issueLinking,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitSense: failed to load commit — ${escapeHtml(message)}</p>`);
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
