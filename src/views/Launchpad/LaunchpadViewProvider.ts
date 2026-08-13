import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import type { GitLogger } from '../../core/git/errors';
import { parseRemoteUrl } from '../../core/git/parsers';
import { buildForgeClient } from '../../core/forge/buildForgeClient';
import { categorizePullRequests } from '../../core/forge/categorize';
import { detectForgeHost, type DetectedForgeHost, type ForgeHostConfig } from '../../core/forge/hostDetection';
import { resolveForgeRepoRef } from '../../core/forge/resolveRepoRef';
import { pullRequestKey, type CategorizedPullRequest, type ForgeRepoRef, type PullRequestSummary } from '../../core/forge/types';
import { clearForgeToken, resolveForgeToken } from '../../providers/forgeCredentials';
import { renderLaunchpadHtml, type LaunchpadRepoError } from './render';
import { renderPlaceholderHtml } from '../placeholder';
import { CONFIG, MEDIA, VIEWS } from '../../constants';

const SNOOZE_STATE_KEY = 'gitLore.launchpad.snoozed';

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
 * A cross-repo PR triage board, in a full editor tab (like Rebase Editor — a 6-column board needs
 * real width, not a narrow docked-panel sliver). Not GitHub-only: resolves every workspace
 * folder's git remote to whichever forge it's on (GitHub, GitLab, Bitbucket, Azure DevOps, or a
 * configured self-hosted/custom instance) and pools their open PRs into one board.
 */
export class LaunchpadViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  /** Overridable only for tests — a real network call has no place in an automated suite. Defaults to the real global `fetch`. */
  private fetchImpl: typeof fetch;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly git: GitService,
    private readonly logger?: GitLogger,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  /** Test-only injection seam, since the extension host constructs one long-lived instance with the real `fetch` — a test needs to swap it after the fact, not at construction. */
  setFetchImplForTest(fetchImpl: typeof fetch): void {
    this.fetchImpl = fetchImpl;
  }

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  getCurrentHtmlForTest(): string | undefined {
    return this.panel?.webview.html;
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(VIEWS.launchpad, 'GitLore Launchpad', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message);
      });
    }
    await this.refresh();
  }

  private mediaUri(name: string): string {
    return this.panel?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  private async refresh(): Promise<void> {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = shellHtml('<p>Loading Launchpad…</p>');
    const styleUris = [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.launchpad)];
    const renderOpts = { nonce: createNonce(), cspSource: this.panel.webview.cspSource, styleUris };

    const customHosts = this.readCustomHosts();
    const repos = await this.resolveWorkspaceRepos(customHosts);
    if (repos.length === 0) {
      this.panel.webview.html = renderPlaceholderHtml(
        'No recognized git-forge remotes found in this workspace — GitHub, GitLab, Bitbucket, and Azure DevOps are supported out of the box; anything else needs an entry in gitLore.launchpad.customHosts.',
        renderOpts,
      );
      return;
    }

    const categorized: CategorizedPullRequest[] = [];
    const errors: LaunchpadRepoError[] = [];

    for (const { repo, detected } of repos) {
      try {
        const token = await resolveForgeToken(this.context.secrets, detected);
        if (!token) {
          errors.push({ repo, message: 'Not signed in.' });
          continue;
        }
        const client = buildForgeClient(detected.flavor, detected.apiBaseUrl, token, this.fetchImpl);
        const login = await client.getAuthenticatedLogin();
        if (!login) {
          // Bad/expired credential — clear it so the *next* refresh re-prompts instead of
          // silently failing the same way forever.
          await clearForgeToken(this.context.secrets, detected);
          errors.push({ repo, message: `Couldn't authenticate with ${detected.displayHost}.` });
          continue;
        }
        const prs = await client.listOpenPullRequests(repo);
        categorized.push(...categorizePullRequests(prs, login, (pr) => this.isSnoozed(pr)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error(`Launchpad failed to load ${repo.label}`, err);
        errors.push({ repo, message });
      }
    }

    if (!this.panel) {
      return;
    }
    this.panel.webview.html = renderLaunchpadHtml({ categorized, errors }, renderOpts);
  }

  private readCustomHosts(): ForgeHostConfig[] {
    return vscode.workspace.getConfiguration(CONFIG.section).get<ForgeHostConfig[]>(CONFIG.launchpadCustomHosts, []);
  }

  /** Every workspace folder's git remote, resolved to a forge repo — deduped, since a multi-root workspace can have several folders pointing at the same repo. */
  /**
   * Every *named* remote in every workspace folder — not just `origin`. A fork's `upstream`, a
   * second `origin`-like remote, or anything else the user has added all get scanned the same
   * way, deduped by resolved repo identity (two remotes, or two workspace folders, can easily
   * point at the same actual repo). Credentials are still resolved once per *host*, not per
   * remote, so having several remotes on the same host never means re-authenticating per remote.
   */
  private async resolveWorkspaceRepos(
    customHosts: ForgeHostConfig[],
  ): Promise<Array<{ repo: ForgeRepoRef; detected: DetectedForgeHost }>> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const results: Array<{ repo: ForgeRepoRef; detected: DetectedForgeHost }> = [];
    const seen = new Set<string>();

    for (const folder of folders) {
      const repoRoot = await this.git.getRepoRoot(folder.uri.fsPath);
      if (!repoRoot) {
        continue;
      }
      const remotes = await this.git.getRemotes(repoRoot);
      for (const remote of remotes) {
        const parsedHost = parseRemoteUrl(remote.url)?.host;
        if (!parsedHost) {
          continue;
        }
        const detected = detectForgeHost(parsedHost, customHosts);
        if (!detected) {
          continue;
        }
        const repo = resolveForgeRepoRef(remote.url, customHosts);
        if (!repo) {
          continue;
        }
        const key = `${repo.host}:${repo.identity}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push({ repo, detected });
      }
    }
    return results;
  }

  private isSnoozed(pr: PullRequestSummary): boolean {
    return this.readSnoozed().includes(pullRequestKey(pr));
  }

  private readSnoozed(): string[] {
    return this.context.globalState.get<string[]>(SNOOZE_STATE_KEY, []);
  }

  private async toggleSnooze(key: string): Promise<void> {
    const current = this.readSnoozed();
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    await this.context.globalState.update(SNOOZE_STATE_KEY, next);
  }

  /** Test-only introspection seam — a webview button click can't be simulated in an integration test, so this drives the same toggle-then-refresh flow the snooze button's message handler does. */
  async toggleSnoozeForTest(key: string): Promise<void> {
    await this.toggleSnooze(key);
    await this.refresh();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, url, key } = message as { type?: unknown; url?: unknown; key?: unknown };

    if (type === 'openPr' && typeof url === 'string') {
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (type === 'toggleSnooze' && typeof key === 'string') {
      await this.toggleSnooze(key);
      await this.refresh();
      return;
    }
    if (type === 'refresh') {
      await this.refresh();
    }
  }
}
