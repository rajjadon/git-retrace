import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderCommitDetailsHtml, type RemoteTarget } from './render';
import { escapeHtml } from '../escapeHtml';
import { resolveIssueLinking } from '../../providers/issueLinking';
import { openFileDiff } from '../../providers/GitContentProvider';
import { buildCommitUrl, remoteHostLabel } from '../../utils/remoteLinks';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { LruCache } from '../../core/cache/LruCache';
import type { LanguageModelClient } from '../../ai/LanguageModelClient';
import type { GitLogger } from '../../core/git/errors';
import { runCommitSummaryFlow } from '../../core/ai/commitSummaryFlow';
import { buildCommitSummaryPrompt, buildLineExplanationPrompt } from '../../core/ai/prompts';
import { COMMANDS, CONFIG, MEDIA, VIEWS } from '../../constants';
import type { CommitDetail } from '../../core/git/types';

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
  private currentFilePath: string | undefined;
  private currentCommit: CommitDetail | undefined;
  private currentRemoteUrl: string | undefined;
  private currentDiff: string | undefined;
  private currentLineContent: string | undefined;
  private aiSummaryCache = new LruCache<string, string>(50);
  private aiAbortController: AbortController | undefined;
  private aiMessagesForTest: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  getCurrentHtmlForTest(): string | undefined {
    return this.view?.webview.html;
  }

  /** Test-only introspection seam, same spirit as `getCurrentHtmlForTest()` — the AI summary's state lives in postMessage traffic, not in the static webview HTML, so there's nothing else to assert against. */
  getAiSummaryMessagesForTest(): unknown[] {
    return this.aiMessagesForTest;
  }

  /** Test-only introspection seam — proves which mode `handleMessage`'s `explainCommit` case will route to, since that decision reads this private field. */
  getCurrentLineContentForTest(): string | undefined {
    return this.currentLineContent;
  }

  hasLoadedCommit(): boolean {
    return this.currentCommit !== undefined;
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
    // The view resolves the moment its tab is revealed, which is usually before any commit has
    // been picked. Say what to do instead of showing an empty rectangle.
    if (!this.currentCommit) {
      webviewView.webview.html = renderPlaceholderHtml('Select a commit in the Commit Graph to see its details.', {
        nonce: createNonce(),
        cspSource: webviewView.webview.cspSource,
        styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.commitDetails)],
      });
    }
  }

  /** Called by "Show Commit Details" (no `lineContent`) or the blame hover's explain-line link (with it) — reveals the panel tab, loads the commit, and auto-runs the line explanation when `lineContent` is given. */
  async show(filePath: string, sha: string, lineContent?: string): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.commitDetails}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, sha, lineContent);
  }

  private mediaUri(name: string): string {
    return this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  private async load(filePath: string, sha: string, lineContent?: string): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentFilePath = filePath;
    this.currentLineContent = lineContent;
    this.aiAbortController?.abort();
    this.aiMessagesForTest = [];
    this.view.title = `Commit ${sha.slice(0, 7)}`;
    this.view.webview.html = shellHtml('<p>Loading commit…</p>');

    try {
      const [commit, files, diff, issueLinking, remoteInfo] = await Promise.all([
        this.git.getCommit(filePath, sha),
        this.git.getCommitFiles(filePath, sha),
        this.git.getCommitDiff(filePath, sha),
        resolveIssueLinking(this.git, filePath),
        this.git.resolveRemoteInfo(filePath),
      ]);
      if (!commit) {
        this.view.webview.html = shellHtml('<p>GitLore: commit not found.</p>');
        return;
      }
      this.currentCommit = commit;
      this.currentDiff = diff;

      // Only offer "Open on <host>" when we know that host's commit-URL shape — a button that
      // reliably 404s is worse than no button.
      const url = remoteInfo ? buildCommitUrl(remoteInfo, commit.sha) : null;
      const remote: RemoteTarget | null = remoteInfo && url ? { label: remoteHostLabel(remoteInfo), url } : null;
      this.currentRemoteUrl = url ?? undefined;

      const editorFontFamily = vscode.workspace
        .getConfiguration('editor')
        .get<string>('fontFamily', 'Menlo, Monaco, monospace');

      this.view.webview.html = renderCommitDetailsHtml(
        { commit, files, diff },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.commitDetails)],
          editorFontFamily,
          issueLinking,
          remote,
          lineExplanation: lineContent !== undefined,
        },
      );

      if (lineContent !== undefined) {
        await this.explainLine(lineContent);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitLore: failed to load commit — ${escapeHtml(message)}</p>`);
    }
  }

  async explainCommit(): Promise<void> {
    await this.runAiFlow((commit, diff, maxDiffChars) => buildCommitSummaryPrompt(commit, diff, maxDiffChars), '');
  }

  /** Auto-invoked by `load()` when opened via the blame hover's "Explain this line with AI" link — the hover click is the user action that authorizes the model call, so no second click is required here. */
  async explainLine(lineContent: string): Promise<void> {
    await this.runAiFlow(
      (commit, diff, maxDiffChars) => buildLineExplanationPrompt(commit, diff, lineContent, maxDiffChars),
      `:line:${lineContent}`,
    );
  }

  /**
   * Shared by `explainCommit()` and `explainLine()` — same disabled/cache/no-model/streaming/error
   * handling either way. `cacheKeySuffix` keeps a whole-commit summary and a line explanation (or
   * two different lines' explanations) of the same commit from colliding in `aiSummaryCache`.
   */
  private async runAiFlow(
    promptBuilder: (commit: CommitDetail, diff: string, maxDiffChars: number) => string,
    cacheKeySuffix: string,
  ): Promise<void> {
    if (!this.view || !this.currentCommit || !this.currentFilePath) {
      return;
    }
    this.aiAbortController?.abort();
    const controller = new AbortController();
    this.aiAbortController = controller;

    const commit = this.currentCommit;
    const diff = this.currentDiff ?? '';
    const filePath = this.currentFilePath;
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const repoRoot = await this.git.getRepoRoot(filePath);
    const cacheKey = `${repoRoot ?? filePath}:${commit.sha}${cacheKeySuffix}`;
    const cached = this.aiSummaryCache.get(cacheKey);

    const flow = runCommitSummaryFlow({
      enabled,
      cached,
      signal: controller.signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => promptBuilder(commit, diff, maxDiffChars),
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
          this.logger.error('AI commit summary failed', event.message);
          this.postAiMessage({ type: 'aiSummaryError', message: event.message });
          break;
      }
    }
  }

  private postAiMessage(message: { type: string; text?: string; message?: string }): void {
    this.aiMessagesForTest.push(message);
    void this.view?.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, path } = message as { type?: unknown; path?: unknown };
    const commit = this.currentCommit;

    if (type === 'copySha' && commit) {
      await vscode.commands.executeCommand(COMMANDS.copySha, commit.sha);
      return;
    }
    if (type === 'copyMessage' && commit) {
      await vscode.env.clipboard.writeText(commit.body);
      void vscode.window.setStatusBarMessage('GitLore: commit message copied', 2000);
      return;
    }
    if (type === 'openRemote' && this.currentRemoteUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentRemoteUrl));
      return;
    }
    if (type === 'explainCommit') {
      // The webview always posts this same message type on a button click, regardless of which
      // mode the panel is in — route based on how the panel was actually opened, so a re-click
      // after a line explanation doesn't silently overwrite it with an unrelated whole-commit
      // summary (currentLineContent is only set when opened via the blame hover's explain-line link).
      if (this.currentLineContent !== undefined) {
        await this.explainLine(this.currentLineContent);
      } else {
        await this.explainCommit();
      }
      return;
    }
    if (type === 'openFileDiff' && typeof path === 'string' && commit && this.currentFilePath) {
      // `<sha>^` doesn't resolve for a root commit; GitService returns an empty left-hand side
      // for that, which is exactly right — every line reads as added.
      await openFileDiff({
        repoPath: this.currentFilePath,
        path,
        beforeRef: `${commit.sha}^`,
        afterRef: commit.sha,
        label: commit.shortSha,
      });
    }
  }
}
