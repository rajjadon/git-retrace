import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { layoutFileHistory } from '../../core/graph/fileHistoryLayout';
import { renderFileHistoryHtml } from './render';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { COMMANDS, MEDIA, VIEWS } from '../../constants';

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

/** Docks the Visual File History bubble timeline in the bottom panel, alongside Commit Graph/Details/Branch Comparison. */
export class VisualFileHistoryViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitService,
  ) {}

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
    if (!this.currentFilePath) {
      webviewView.webview.html = renderPlaceholderHtml('Open a tracked file to see its Visual File History.', {
        nonce: createNonce(),
        cspSource: webviewView.webview.cspSource,
        styleUris: [this.mediaUri(MEDIA.shared)],
      });
    }
  }

  /** Called by the "Show Visual File History" command — reveals the panel tab and (re)loads from the given file. */
  async show(filePath: string, maxCount: number): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.visualFileHistory}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, maxCount);
  }

  private async load(filePath: string, maxCount: number): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentFilePath = filePath;
    const styleUris = [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.visualFileHistory)];
    this.view.webview.html = renderPlaceholderHtml('Loading file history…', {
      nonce: createNonce(),
      cspSource: this.view.webview.cspSource,
      styleUris,
      variant: 'loading',
    });

    try {
      const entries = await this.git.getFileHistoryStats(filePath, maxCount);
      const points = layoutFileHistory(entries, new Date());
      this.view.webview.html = renderFileHistoryHtml(
        { points },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = renderPlaceholderHtml(`GitLore: failed to load file history — ${message}`, {
        nonce: createNonce(),
        cspSource: this.view.webview.cspSource,
        styleUris,
        variant: 'error',
      });
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, sha } = message as { type?: unknown; sha?: unknown };
    if (type === 'openCommit' && typeof sha === 'string' && this.currentFilePath) {
      await vscode.commands.executeCommand(COMMANDS.showCommit, this.currentFilePath, sha);
    }
  }
}
