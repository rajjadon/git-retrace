import * as vscode from 'vscode';
import type { ForgeClient } from '../../core/forge/ForgeClient';
import type { ConversationThread, PullRequestSummary } from '../../core/forge/types';
import { pullRequestKey } from '../../core/forge/types';
import { renderPullRequestDetailsHtml } from './render';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { LruCache } from '../../core/cache/LruCache';
import type { LanguageModelClient } from '../../ai/LanguageModelClient';
import type { GitLogger } from '../../core/git/errors';
import { runCommitSummaryFlow } from '../../core/ai/commitSummaryFlow';
import { buildPrExplanationPrompt, buildPrReviewDraftPrompt } from '../../core/ai/prompts';
import { CONFIG, MEDIA, VIEWS } from '../../constants';

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
  private aiSummaryCache = new LruCache<string, string>(50);
  private aiAbortController: AbortController | undefined;
  private aiMessagesForTest: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  getCurrentHtmlForTest(): string | undefined {
    return this.view?.webview.html;
  }

  getAiSummaryMessagesForTest(): unknown[] {
    return this.aiMessagesForTest;
  }

  /** A short label for the chat's subject chip, e.g. when opened via "Ask about this PR". */
  getCurrentSubjectForChat(): string | undefined {
    return this.currentPr ? `PR #${this.currentPr.number} — ${this.currentPr.title}` : undefined;
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
    this.aiAbortController?.abort();
    this.aiMessagesForTest = [];
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
    if (type === 'explainPr') {
      await this.explainPr();
      return;
    }
    if (type === 'draftReview') {
      await this.draftReview();
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

  async explainPr(): Promise<void> {
    if (!this.view || !this.currentPr) {
      return;
    }
    this.aiAbortController?.abort();
    const controller = new AbortController();
    this.aiAbortController = controller;

    const pr = this.currentPr;
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const cacheKey = pullRequestKey(pr);
    const cached = this.aiSummaryCache.get(cacheKey);

    // AI-disabled is one of runCommitSummaryFlow's own branches ('disabled'), but that check
    // happens only once the flow starts — too late to guard the diff fetch below, which is a real
    // network call to the forge host (unlike CommitDetailsViewProvider's diff, which is free local
    // state). Checking `enabled` here, before any I/O, keeps a disabled-AI click from ever hitting
    // the network only to throw the result away.
    let diff = '';
    if (enabled && !cached && this.currentClient) {
      const { diff: fetchedDiff } = await this.currentClient.getPullRequestDiff(pr.repo, pr.number);
      diff = fetchedDiff;
    }

    const flow = runCommitSummaryFlow({
      enabled,
      cached,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildPrExplanationPrompt(pr, diff, maxDiffChars),
    });

    for await (const event of flow) {
      if (controller.signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
          void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG.section}.${CONFIG.aiEnabled}`);
            }
          });
          this.postAiMessage({ type: 'aiSummaryReset' });
          break;
        case 'cached':
          this.postAiMessage({ type: 'aiSummaryCached', text: event.text });
          break;
        case 'noModel':
          this.postAiMessage({ type: 'aiSummaryNoModel' });
          break;
        case 'chunk':
          this.postAiMessage({ type: 'aiSummaryChunk', text: event.text });
          break;
        case 'done':
          this.aiSummaryCache.set(cacheKey, event.text);
          this.postAiMessage({ type: 'aiSummaryDone' });
          break;
        case 'error':
          this.logger.error('AI PR explanation failed', event.message);
          this.postAiMessage({ type: 'aiSummaryError', message: event.message });
          break;
      }
    }
  }

  async draftReview(): Promise<void> {
    if (!this.view || !this.currentPr || !this.currentClient) {
      return;
    }
    this.aiAbortController?.abort();
    const controller = new AbortController();
    this.aiAbortController = controller;

    const pr = this.currentPr;
    const client = this.currentClient;
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    // Same guard as explainPr(): checking `enabled` before fetching anything keeps a disabled-AI
    // click from firing two real network calls to the forge host only to discard both results —
    // runCommitSummaryFlow's own 'disabled' branch fires too late to protect the fetch below it.
    let diff = '';
    let threads: ConversationThread[] = [];
    if (enabled) {
      const [diffResult, threadsResult] = await Promise.all([
        client.getPullRequestDiff(pr.repo, pr.number),
        client.listConversationThreads(pr.repo, pr.number),
      ]);
      diff = diffResult.diff;
      threads = threadsResult;
    }

    const flow = runCommitSummaryFlow({
      enabled,
      cached: undefined,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildPrReviewDraftPrompt(pr, diff, threads, maxDiffChars),
    });

    for await (const event of flow) {
      if (controller.signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
          void vscode.window.showInformationMessage('GitLore: AI features are disabled.', 'Open Settings').then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', `${CONFIG.section}.${CONFIG.aiEnabled}`);
            }
          });
          this.postAiMessage({ type: 'draftReviewReset' });
          break;
        case 'cached':
          // Never reached: this flow always passes cached: undefined.
          break;
        case 'noModel':
          this.postAiMessage({ type: 'draftReviewNoModel' });
          break;
        case 'chunk':
          this.postAiMessage({ type: 'draftReviewChunk', text: event.text });
          break;
        case 'done':
          this.postAiMessage({ type: 'draftReviewDone' });
          break;
        case 'error':
          this.logger.error('AI PR review draft failed', event.message);
          this.postAiMessage({ type: 'draftReviewError', message: event.message });
          break;
      }
    }
  }

  private postAiMessage(message: { type: string; text?: string; message?: string }): void {
    this.aiMessagesForTest.push(message);
    void this.view?.webview.postMessage(message);
  }
}
