import * as vscode from 'vscode';
import type { ForgeClient } from '../../core/forge/ForgeClient';
import type { PullRequestSummary } from '../../core/forge/types';
import { renderPullRequestDetailsHtml } from './render';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { escapeHtml } from '../escapeHtml';
import { MEDIA, VIEWS } from '../../constants';

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

/** Docks a PR's diff/commits in the bottom panel (next to Commit Details), instead of opening a new editor tab per PR — same shape as `CommitDetailsViewProvider`, for a PR instead of a local commit. */
export class PullRequestDetailsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentPr: PullRequestSummary | undefined;
  private currentUrl: string | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

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
    if (!this.currentPr) {
      webviewView.webview.html = renderPlaceholderHtml('Open a PR from Launchpad to see its details.', {
        nonce: createNonce(),
        cspSource: webviewView.webview.cspSource,
        styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.pullRequestDetails)],
      });
    }
  }

  /** Called by the "Show Pull Request Details" command — reveals the panel tab and loads the given PR's diff. */
  async show(pr: PullRequestSummary, client: ForgeClient): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.pullRequestDetails}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(pr, client);
  }

  private mediaUri(name: string): string {
    return this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  private async load(pr: PullRequestSummary, client: ForgeClient): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentPr = pr;
    this.currentUrl = pr.url;
    this.view.title = `PR #${pr.number}`;
    this.view.webview.html = shellHtml('<p>Loading pull request…</p>');

    try {
      const { files, diff } = await client.getPullRequestDiff(pr.repo, pr.number);
      if (!this.view) {
        return;
      }
      this.view.webview.html = renderPullRequestDetailsHtml(
        { pr, files, diff },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.pullRequestDetails)],
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitLore: failed to load this pull request's diff — ${escapeHtml(message)}</p>`);
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type } = message as { type?: unknown };
    if (type === 'openRemote' && this.currentUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentUrl));
    }
  }
}
