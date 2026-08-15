import * as vscode from 'vscode';
import type { ForgeClient } from '../../core/forge/ForgeClient';
import type { PullRequestSummary } from '../../core/forge/types';
import { renderPullRequestDetailsHtml } from './render';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { MEDIA, VIEWS } from '../../constants';

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

/** Docks a PR's diff/commits in the bottom panel (next to Commit Details), instead of opening a new editor tab per PR — same shape as `CommitDetailsViewProvider`, for a PR instead of a local commit. */
export class PullRequestDetailsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentPr: PullRequestSummary | undefined;
  private currentUrl: string | undefined;
  private currentClient: ForgeClient | undefined;

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
    this.currentClient = client;
    this.view.title = `PR #${pr.number}`;
    const styleUris = [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.pullRequestDetails)];
    this.view.webview.html = renderPlaceholderHtml('Loading pull request…', {
      nonce: createNonce(),
      cspSource: this.view.webview.cspSource,
      styleUris,
      variant: 'loading',
    });

    try {
      const [{ files, diff }, threads] = await Promise.all([
        client.getPullRequestDiff(pr.repo, pr.number),
        client.listConversationThreads(pr.repo, pr.number),
      ]);
      if (!this.view) {
        return;
      }
      this.view.webview.html = renderPullRequestDetailsHtml(
        { pr, files, diff, threads },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = renderPlaceholderHtml(`GitLore: failed to load this pull request's diff — ${message}`, {
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
    const { type, body, threadId } = message as { type?: unknown; body?: unknown; threadId?: unknown };
    if (type === 'openRemote' && this.currentUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentUrl));
      return;
    }
    if (type === 'addComment' && typeof body === 'string' && this.currentPr && this.currentClient) {
      await this.addComment(this.currentPr, this.currentClient, body);
      return;
    }
    if (type === 'resolveThread' && typeof threadId === 'string' && this.currentPr && this.currentClient) {
      await this.resolveThread(this.currentPr, this.currentClient, threadId);
      return;
    }
    if (type === 'refresh' && this.currentPr && this.currentClient) {
      // The panel doesn't know about actions taken elsewhere (e.g. approving this same PR from a
      // Launchpad card) — a manual refresh is the deliberately simple fix over wiring up
      // cross-webview notifications for what's a rare case.
      await this.load(this.currentPr, this.currentClient);
    }
  }

  private async resolveThread(pr: PullRequestSummary, client: ForgeClient, threadId: string): Promise<void> {
    try {
      await client.resolveConversationThread(pr.repo, pr.number, threadId);
      // Reloads the whole panel (diff included) rather than patching just the thread list in
      // place — same "confirm/act, then reload" shape every other write action in this feature
      // uses (Launchpad's close/approve/comment all do a full refresh too), and a PR's diff is
      // cheap enough to refetch that a separate partial-update path isn't worth the extra code.
      await this.load(pr, client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`GitLore: couldn't resolve that conversation — ${message}`);
      // On success the whole panel reloads, which clears the button's disabled state along with
      // everything else — on failure nothing else re-renders, so the button needs telling explicitly.
      void this.view?.webview.postMessage({ type: 'resolveThreadFailed', threadId });
    }
  }

  /** Test-only introspection seam — a webview button click can't be driven from an integration test, so this calls the resolve flow directly. */
  async resolveThreadForTest(threadId: string): Promise<void> {
    if (!this.currentPr || !this.currentClient) {
      return;
    }
    await this.resolveThread(this.currentPr, this.currentClient, threadId);
  }

  private async addComment(pr: PullRequestSummary, client: ForgeClient, body: string): Promise<void> {
    try {
      await client.addComment(pr.repo, pr.number, body);
      void this.view?.webview.postMessage({ type: 'commentPosted' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`GitLore: couldn't post that comment — ${message}`);
      void this.view?.webview.postMessage({ type: 'commentFailed' });
    }
  }

  /** Test-only introspection seam — a webview form submit can't be driven from an integration test, so this calls the comment flow directly. */
  async addCommentForTest(body: string): Promise<void> {
    if (!this.currentPr || !this.currentClient) {
      return;
    }
    await this.addComment(this.currentPr, this.currentClient, body);
  }
}
