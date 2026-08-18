import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import type { GitLogger } from '../../core/git/errors';
import { parseRemoteUrl } from '../../core/git/parsers';
import { buildForgeClient } from '../../core/forge/buildForgeClient';
import { categorizeClosedPullRequests, categorizePullRequests } from '../../core/forge/categorize';
import { detectForgeHost, type DetectedForgeHost, type ForgeHostConfig } from '../../core/forge/hostDetection';
import type { ForgeClient } from '../../core/forge/ForgeClient';
import { resolveForgeRepoRef } from '../../core/forge/resolveRepoRef';
import {
  MERGE_STRATEGIES_BY_HOST,
  pullRequestKey,
  type CategorizedPullRequest,
  type ForgeRepoRef,
  type MergeStrategy,
  type PullRequestSummary,
  type ReviewSubmission,
} from '../../core/forge/types';
import { azureDevOpsCredentialScheme, clearForgeToken, resolveForgeToken, signOutOfForgeHost } from '../../providers/forgeCredentials';
import { renderLaunchpadHtml, type LaunchpadRepoError, type LaunchpadRepoRow } from './render';
import { renderPlaceholderHtml } from '../placeholder';
import { COMMANDS, CONFIG, MEDIA, VIEWS } from '../../constants';
import { runInGitSyncTerminal } from '../gitSyncTerminal';

const SNOOZE_STATE_KEY = 'gitLore.launchpad.snoozed';

/** Labels/descriptions for the merge-strategy QuickPick, one per `MergeStrategy` — filtered per host via `MERGE_STRATEGIES_BY_HOST` before it's ever shown, so a host never offers a strategy it can't actually perform. */
const STRATEGY_QUICK_PICK_LABELS: Record<MergeStrategy, { label: string; description: string }> = {
  merge: { label: 'Merge', description: 'Create a merge commit' },
  squash: { label: 'Squash and merge', description: 'Combine all commits into one' },
  rebase: { label: 'Rebase and merge', description: 'Replay commits onto the base — no merge commit' },
};

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
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

  /** Rebuilt on every refresh — lets the "Close PR" action find the right host's client and the PR's `repo`/`number` from just the card's stable key, without re-parsing that key's opaque `identity`. */
  private clientsByRepoKey = new Map<string, ForgeClient>();
  private prsByKey = new Map<string, PullRequestSummary>();
  /** Rebuilt on every refresh — lets Push/Pull find the right local working copy from a repo row's stable key. Populated regardless of forge auth outcome: push/pull is a local git operation that doesn't need a host credential at all. */
  private repoRootByKey = new Map<string, string>();
  /** Rebuilt on every refresh — lets "Sign Out" reset the right host's credential from just a repo row's stable key, regardless of whether that repo's auth currently succeeds or is broken. */
  private detectedByRepoKey = new Map<string, DetectedForgeHost>();
  private repoLabelByKey = new Map<string, string>();
  /** Rebuilt on every refresh — the signed-in login per repo, so `submitReview` can catch "you're reviewing your own PR" before ever calling the host's API. Every host we support rejects a self-review one way or another; catching it here turns that into one clear message instead of a different opaque API error per host. */
  private loginByRepoKey = new Map<string, string>();

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

  /**
   * `showLoadingPlaceholder` defaults to true for the initial open and an explicit "Refresh"
   * click, where a brief loading state is expected. A refresh that follows a card action
   * (snooze/close/approve) passes `false` — setting `webview.html` at all forces VS Code to fully
   * reset the webview's DOM, so blanking it out first (as this always used to do) made every
   * successful action visibly flash back to a loading screen before repainting the board.
   */
  private async refresh(showLoadingPlaceholder = true): Promise<void> {
    if (!this.panel) {
      return;
    }
    const styleUris = [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.launchpad)];
    const renderOpts = { nonce: createNonce(), cspSource: this.panel.webview.cspSource, styleUris };
    if (showLoadingPlaceholder) {
      this.panel.webview.html = renderPlaceholderHtml('Loading Launchpad…', { ...renderOpts, variant: 'loading' });
    }

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
    this.clientsByRepoKey = new Map();
    this.prsByKey = new Map();
    this.repoRootByKey = new Map();
    this.loginByRepoKey = new Map();
    this.detectedByRepoKey = new Map();
    this.repoLabelByKey = new Map();
    const repoRows: LaunchpadRepoRow[] = [];

    for (const { repo, detected, repoRoot } of repos) {
      const repoKey = `${repo.host}:${repo.identity}`;
      this.repoRootByKey.set(repoKey, repoRoot);
      this.detectedByRepoKey.set(repoKey, detected);
      this.repoLabelByKey.set(repoKey, repo.label);
      repoRows.push({ key: repoKey, label: repo.label });
      try {
        const token = await resolveForgeToken(this.context.secrets, detected);
        if (!token) {
          errors.push({ repo, message: 'Not signed in.' });
          continue;
        }
        const client = buildForgeClient(
          detected.flavor,
          detected.apiBaseUrl,
          repo.identity,
          token,
          azureDevOpsCredentialScheme(detected),
          this.fetchImpl,
        );

        let login: string | null;
        try {
          login = await client.getAuthenticatedLogin();
        } catch (err) {
          // Bad/expired/wrongly-scoped credential, or the host unreachable — clear it so the
          // *next* refresh re-prompts instead of retrying the same bad credential forever, and
          // show the real reason (HTTP status, network failure) instead of a one-size-fits-all
          // "couldn't authenticate" that gives the user nothing to act on.
          await clearForgeToken(this.context.secrets, detected);
          const reason = err instanceof Error ? err.message : String(err);
          this.logger?.error(`Launchpad failed to authenticate with ${detected.displayHost}`, err);
          errors.push({ repo, message: `Couldn't authenticate with ${detected.displayHost}: ${reason}` });
          continue;
        }
        if (!login) {
          await clearForgeToken(this.context.secrets, detected);
          errors.push({ repo, message: `Couldn't authenticate with ${detected.displayHost}.` });
          continue;
        }
        this.clientsByRepoKey.set(`${repo.host}:${repo.identity}`, client);
        this.loginByRepoKey.set(`${repo.host}:${repo.identity}`, login);
        const [prs, closedPrs] = await Promise.all([client.listOpenPullRequests(repo), client.listRecentlyClosedPullRequests(repo)]);
        const openCategorized = categorizePullRequests(prs, login, (pr) => this.isSnoozed(pr));
        const closedCategorized = categorizeClosedPullRequests(closedPrs, login);
        categorized.push(...openCategorized, ...closedCategorized);
        // Merged/closed PRs need to be resolvable too — View diff (rendered on every card,
        // terminal or not) and the new Reopen action both look a card's key up here.
        for (const { pr } of [...openCategorized, ...closedCategorized]) {
          this.prsByKey.set(pullRequestKey(pr), pr);
        }
      } catch (err) {
        // A PR list call failing (as opposed to succeeding with zero results) almost always means
        // the credential itself is bad — expired, or scoped for identity but not this host's PR
        // API (e.g. an Azure DevOps PAT missing "Code" scope). Clear it so the next refresh
        // re-prompts instead of silently showing an empty board forever.
        await clearForgeToken(this.context.secrets, detected);
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error(`Launchpad failed to load ${repo.label}`, err);
        errors.push({ repo, message });
      }
    }

    if (!this.panel) {
      return;
    }
    this.panel.webview.html = renderLaunchpadHtml({ categorized, errors, repoRows }, renderOpts);
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
  ): Promise<Array<{ repo: ForgeRepoRef; detected: DetectedForgeHost; repoRoot: string }>> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const results: Array<{ repo: ForgeRepoRef; detected: DetectedForgeHost; repoRoot: string }> = [];
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
        results.push({ repo, detected, repoRoot });
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
    await this.refresh(false);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, url, key, title, decision } = message as {
      type?: unknown;
      url?: unknown;
      key?: unknown;
      title?: unknown;
      decision?: unknown;
    };

    if (type === 'openPr' && typeof url === 'string') {
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (type === 'toggleSnooze' && typeof key === 'string') {
      await this.toggleSnooze(key);
      await this.refresh(false);
      return;
    }
    if (type === 'closePr' && typeof key === 'string') {
      await this.closePullRequest(key, typeof title === 'string' ? title : key);
      return;
    }
    if (type === 'reopenPr' && typeof key === 'string') {
      await this.reopenPullRequest(key, typeof title === 'string' ? title : key);
      return;
    }
    if (type === 'mergePr' && typeof key === 'string') {
      await this.mergePullRequest(key, typeof title === 'string' ? title : key);
      return;
    }
    if (type === 'submitReview' && typeof key === 'string' && (decision === 'approve' || decision === 'requestChanges')) {
      await this.submitReview(key, typeof title === 'string' ? title : key, decision);
      return;
    }
    if (type === 'showPullRequestDetails' && typeof key === 'string') {
      await vscode.commands.executeCommand(COMMANDS.showPullRequest, key);
      return;
    }
    if ((type === 'pull' || type === 'push') && typeof key === 'string') {
      this.syncRepo(key, type);
      return;
    }
    if (type === 'signOut' && typeof key === 'string') {
      await this.signOut(key);
      return;
    }
    if (type === 'refresh') {
      await this.refresh();
    }
  }

  /**
   * Resets the credential for one repo's host — the fix for "I signed in as the wrong account and
   * there's no way to change it": before this, a bad credential only ever got cleared internally
   * on an API failure, and never at all for a built-in session (github.com/dev.azure.com), which
   * `clearForgeToken` deliberately never touches. `signOutOfForgeHost` handles both cases; the
   * refresh right after immediately re-triggers `resolveForgeToken`'s prompt, same as any other
   * "not signed in" repo.
   */
  private async signOut(key: string): Promise<void> {
    const detected = this.detectedByRepoKey.get(key);
    if (!detected) {
      return;
    }
    const label = this.repoLabelByKey.get(key) ?? detected.displayHost;
    const confirmed = await vscode.window.showWarningMessage(
      `Sign out of ${label}? Launchpad will ask you to sign in again on the next refresh.`,
      { modal: true },
      'Sign Out',
    );
    if (confirmed !== 'Sign Out') {
      return;
    }
    try {
      await signOutOfForgeHost(this.context.secrets, detected);
      await this.refresh(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error(`Launchpad failed to sign out of ${detected.displayHost}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't sign out — ${message}`);
    }
  }

  /** Test-only introspection seam — a webview button click (and the real confirmation modal it triggers) can't be driven from an integration test, so this calls the sign-out flow directly, skipping only the modal. */
  async signOutForTest(key: string): Promise<void> {
    const detected = this.detectedByRepoKey.get(key);
    if (!detected) {
      return;
    }
    await signOutOfForgeHost(this.context.secrets, detected);
    await this.refresh(false);
  }

  /**
   * Runs in a real terminal, not via simple-git — pull/push can need interactive auth (an SSH
   * passphrase, a credential-manager prompt) or land a merge conflict on pull, and a terminal is
   * where the user can actually see and handle either. Same pattern and shared terminal as Commit
   * Graph's sync buttons (`CommitGraphViewProvider.ts`) — Launchpad doesn't track "did it finish"
   * either; the user sees the result in the terminal and can refresh the board themselves.
   */
  private syncRepo(repoKey: string, direction: 'pull' | 'push'): void {
    const repoRoot = this.repoRootByKey.get(repoKey);
    if (!repoRoot) {
      return;
    }
    runInGitSyncTerminal(repoRoot, direction === 'pull' ? 'git pull' : 'git push');
  }

  /** Test-only introspection seam — a webview button click can't be simulated in an integration test, so this drives the same lookup-then-terminal flow the push/pull message handler does. */
  syncRepoForTest(repoKey: string, direction: 'pull' | 'push'): void {
    this.syncRepo(repoKey, direction);
  }

  /** Resolves a card's key back to its `PullRequestSummary` and the `ForgeClient` that owns it — used by the "Show Pull Request Details" command, same lookup `closePullRequest` already does. `undefined` if the board has since refreshed and this PR is no longer on it. */
  resolvePullRequestForDetails(key: string): { pr: PullRequestSummary; client: ForgeClient } | undefined {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return undefined;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return undefined;
    }
    return { pr, client };
  }

  private async closePullRequest(key: string, title: string): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(`Close "${title}"? This closes it on ${pr.repo.label} without merging.`, { modal: true }, 'Close PR');
    if (confirmed !== 'Close PR') {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    try {
      await client.closePullRequest(pr.repo, pr.number);
      await this.refresh(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error(`Launchpad failed to close PR ${key}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't close the PR — ${message}`);
    }
  }

  /** Test-only introspection seam — a webview button click (and the real confirmation modal it triggers) can't be driven from an integration test, so this calls the close flow directly, skipping only the modal. */
  async closePullRequestForTest(key: string): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    await client.closePullRequest(pr.repo, pr.number);
    await this.refresh(false);
  }

  private async reopenPullRequest(key: string, title: string): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(`Reopen "${title}" on ${pr.repo.label}?`, { modal: true }, 'Reopen PR');
    if (confirmed !== 'Reopen PR') {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    try {
      await client.reopenPullRequest(pr.repo, pr.number);
      await this.refresh(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error(`Launchpad failed to reopen PR ${key}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't reopen the PR — ${message}`);
    }
  }

  /** Test-only introspection seam — a webview button click (and the real confirmation modal it triggers) can't be driven from an integration test, so this calls the reopen flow directly, skipping only the modal. */
  async reopenPullRequestForTest(key: string): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    await client.reopenPullRequest(pr.repo, pr.number);
    await this.refresh(false);
  }

  /**
   * A QuickPick for the strategy (filtered to what this PR's host actually supports), then one
   * modal confirm with two buttons — "Merge" and "Merge & Delete Branch" — rather than a third,
   * separate prompt for the delete-branch choice. Escaping either prompt aborts without calling
   * the host at all, same as every other confirmed Launchpad action.
   */
  private async mergePullRequest(key: string, title: string): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    const strategy = await this.pickMergeStrategy(pr);
    if (!strategy) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Merge "${title}" on ${pr.repo.label}? This can't be undone.`,
      { modal: true },
      'Merge',
      'Merge & Delete Branch',
    );
    if (confirmed !== 'Merge' && confirmed !== 'Merge & Delete Branch') {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    try {
      await client.mergePullRequest(pr.repo, pr.number, { strategy, deleteSourceBranch: confirmed === 'Merge & Delete Branch' });
      await this.refresh(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error(`Launchpad failed to merge PR ${key}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't merge the PR — ${message}`);
    }
  }

  private async pickMergeStrategy(pr: PullRequestSummary): Promise<MergeStrategy | undefined> {
    const items = MERGE_STRATEGIES_BY_HOST[pr.repo.host].map((strategy) => ({ ...STRATEGY_QUICK_PICK_LABELS[strategy], strategy }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'How should this pull request be merged?' });
    return picked?.strategy;
  }

  /** Test-only introspection seam — the merge QuickPick and confirmation modal can't be driven from an integration test, so this calls the merge flow directly with a fixed strategy/delete choice, skipping both prompts. */
  async mergePullRequestForTest(key: string, strategy: MergeStrategy, deleteSourceBranch: boolean): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    await client.mergePullRequest(pr.repo, pr.number, { strategy, deleteSourceBranch });
    await this.refresh(false);
  }

  /** Every host we support rejects a review from the PR's own author one way or another — catching it here, before the API call, turns that into one clear message instead of a different opaque rejection per host (see the 422 GitHub returns for exactly this). */
  private isOwnPullRequest(pr: PullRequestSummary): boolean {
    const login = this.loginByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    return !!login && pr.authorLogin.toLowerCase() === login.toLowerCase();
  }

  private async submitReview(key: string, title: string, decision: ReviewSubmission): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    if (this.isOwnPullRequest(pr)) {
      void vscode.window.showWarningMessage("GitLore: you can't review your own pull request.");
      return;
    }
    const verb = decision === 'approve' ? 'Approve' : 'Request changes on';
    const confirmed = await vscode.window.showWarningMessage(`${verb} "${title}" on ${pr.repo.label}?`, { modal: true }, verb);
    if (confirmed !== verb) {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    try {
      await client.submitReview(pr.repo, pr.number, decision);
      await this.refresh(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error(`Launchpad failed to submit a review for PR ${key}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't submit that review — ${message}`);
    }
  }

  /** Test-only introspection seam — a webview button click (and the real confirmation modal it triggers) can't be driven from an integration test, so this calls the review flow directly, skipping only the modal. */
  async submitReviewForTest(key: string, decision: ReviewSubmission): Promise<void> {
    const pr = this.prsByKey.get(key);
    if (!pr) {
      return;
    }
    if (this.isOwnPullRequest(pr)) {
      return;
    }
    const client = this.clientsByRepoKey.get(`${pr.repo.host}:${pr.repo.identity}`);
    if (!client) {
      return;
    }
    await client.submitReview(pr.repo, pr.number, decision);
    await this.refresh(false);
  }
}
