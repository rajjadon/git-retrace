import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderBranchComparisonHtml } from './render';
import { escapeHtml } from '../escapeHtml';
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

/** Docks branch comparison in the bottom panel (next to Commit Graph/Commit Details), matching GitLens's panel layout, instead of opening a new editor tab per comparison. */
export class BranchComparisonViewProvider implements vscode.WebviewViewProvider {
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

  /** Called by the "Compare Branches" command — reveals the panel tab and loads the given comparison. */
  async show(filePath: string, base: string, compare: string): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.branchComparison}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, base, compare);
  }

  private async load(filePath: string, base: string, compare: string): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentFilePath = filePath;
    this.view.title = `${base}...${compare}`;
    this.view.webview.html = shellHtml('<p>Loading comparison…</p>');

    try {
      const [aheadCommits, behindCommits, files, diff] = await Promise.all([
        this.git.getCommitsBetween(filePath, base, compare),
        this.git.getCommitsBetween(filePath, compare, base),
        this.git.getFilesBetweenRefs(filePath, base, compare),
        this.git.getDiffBetweenRefs(filePath, base, compare),
      ]);

      const styleUri = this.view.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'media', 'branchComparison.css'),
      );
      this.view.webview.html = renderBranchComparisonHtml(
        { base, compare, aheadCommits, behindCommits, files, diff },
        { nonce: createNonce(), cspSource: this.view.webview.cspSource, styleUri: styleUri.toString() },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitSense: failed to load the comparison — ${escapeHtml(message)}</p>`);
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    const isOpenCommit =
      typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'openCommit';
    const sha = isOpenCommit ? (message as { sha?: unknown }).sha : undefined;
    if (typeof sha === 'string' && this.currentFilePath) {
      await vscode.commands.executeCommand(COMMANDS.showCommit, this.currentFilePath, sha);
    }
  }
}
