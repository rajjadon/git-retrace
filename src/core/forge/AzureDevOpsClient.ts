import type { FileChange } from '../git/types';
import type { ForgeClient } from './ForgeClient';
import { splitAzureDevOpsIdentity } from './azureDevOpsIdentity';
import type { CheckStatus, ConversationThread, ForgeRepoRef, PullRequestDiff, PullRequestSummary, ReviewDecision, ReviewSubmission } from './types';

interface AzureDevOpsIdentityRef {
  uniqueName?: string;
  displayName?: string;
}

interface AzureDevOpsReviewer extends AzureDevOpsIdentityRef {
  /** 10 = approved, 5 = approved with suggestions, 0 = no vote, -5 = waiting for author, -10 = rejected. */
  vote: number;
}

interface AzureDevOpsPullRequest {
  pullRequestId: number;
  title: string;
  createdBy: AzureDevOpsIdentityRef;
  isDraft?: boolean;
  creationDate: string;
  closedDate?: string;
  reviewers?: AzureDevOpsReviewer[];
  lastMergeSourceCommit?: { commitId: string };
  mergeStatus?: 'succeeded' | 'conflicts' | 'failure' | 'queued' | 'notSet';
}

interface AzureDevOpsListResponse<T> {
  value: T[];
}

interface AzureDevOpsStatus {
  state: 'succeeded' | 'error' | 'failed' | 'pending' | 'notApplicable' | 'notSet';
}

interface AzureDevOpsProfile {
  id?: string;
  emailAddress?: string;
  displayName?: string;
}

interface AzureDevOpsIteration {
  id: number;
}

interface AzureDevOpsChangeEntry {
  item: { path: string };
}

interface AzureDevOpsIterationChanges {
  changeEntries: AzureDevOpsChangeEntry[];
}

type AzureDevOpsThreadStatus = 'unknown' | 'active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending';

interface AzureDevOpsThreadComment {
  content: string;
  author: AzureDevOpsIdentityRef;
  /** Vote-change notifications and similar auto-generated entries come through as their own threads with `commentType: 'system'` — not a genuine review conversation. */
  commentType?: 'text' | 'codeChange' | 'system' | 'unknown';
}

interface AzureDevOpsThread {
  id: number;
  status?: AzureDevOpsThreadStatus;
  comments: AzureDevOpsThreadComment[];
  isDeleted?: boolean;
}

const UNRESOLVED_STATUSES = new Set<AzureDevOpsThreadStatus | undefined>(['active', 'pending', 'unknown', undefined]);

function loginOf(ref: AzureDevOpsIdentityRef): string {
  return ref.uniqueName ?? ref.displayName ?? '';
}

function computeCheckStatus(statuses: AzureDevOpsStatus[]): CheckStatus {
  if (statuses.length === 0) {
    return 'none';
  }
  if (statuses.some((s) => s.state === 'pending')) {
    return 'pending';
  }
  if (statuses.some((s) => s.state === 'error' || s.state === 'failed')) {
    return 'failing';
  }
  return 'passing';
}

/** Azure DevOps' numeric vote model, normalized: -10 (rejected) is the one unambiguous "changes requested" signal; anything <= 0 otherwise still counts as "hasn't approved yet". */
function reviewersInfo(reviewers: AzureDevOpsReviewer[]): { requestedReviewers: string[]; reviewDecision: ReviewDecision } {
  if (reviewers.some((r) => r.vote === -10)) {
    return { requestedReviewers: reviewers.filter((r) => r.vote <= 0).map(loginOf), reviewDecision: 'changesRequested' };
  }
  const stillOwed = reviewers.filter((r) => r.vote <= 0).map(loginOf);
  if (stillOwed.length > 0) {
    return { requestedReviewers: stillOwed, reviewDecision: 'reviewRequired' };
  }
  if (reviewers.length > 0) {
    return { requestedReviewers: [], reviewDecision: 'approved' };
  }
  return { requestedReviewers: [], reviewDecision: 'none' };
}

/**
 * The only place that talks to Azure DevOps' REST API. Unlike the other three hosts, a repo here
 * has no two-part owner/repo identity — `repo.identity` is "organization/project/repository" (see
 * `azureDevOpsIdentity.ts`), and PR URLs are always built under `dev.azure.com`, even for orgs
 * whose remote uses the legacy `<org>.visualstudio.com` hostname (that hostname still resolves,
 * but `dev.azure.com` is the canonical modern one for every org).
 *
 * The identity ("who am I") check lives on a *different* host (`vssps.dev.azure.com`) than the
 * main API (`dev.azure.com`) — a genuine, well-documented Azure DevOps quirk, not a mistake here.
 * That profile check must be routed through the org (`vssps.dev.azure.com/{organization}/...`),
 * not the legacy global `app.vssps.visualstudio.com/...` host: a PAT scoped to one organization
 * (the default Azure DevOps offers when creating one) 401s against the global host even though
 * the exact same token works fine against every other endpoint here. PR authors/reviewers are
 * matched by `uniqueName` (their email/UPN), the same value the profile API returns as
 * `emailAddress`. That same profile response's `id` (a GUID) is cached and reused to scope the
 * closed-PR search server-side via `searchCriteria.creatorId`, so the current user's own older
 * merged/abandoned PRs aren't silently dropped by the `$top=10` window over a busy shared repo's
 * most-recently-closed PRs before `categorizeClosedPullRequests` ever filters by author.
 *
 * `credentialScheme` exists because `dev.azure.com` accepts two unrelated credential shapes: a
 * PAT (HTTP Basic) from `forgeCredentials.ts`'s manual-entry flow, or an AAD OAuth access token
 * (HTTP Bearer) from VS Code's built-in Microsoft session — the latter is the only thing that
 * works for organizations whose Conditional Access policy blocks PAT/Basic auth outright, no
 * matter how broad the PAT's own scope is.
 */
/** How `token` should be presented: a PAT (HTTP Basic, empty username) or an AAD OAuth access token from `vscode.authentication`'s built-in Microsoft session (HTTP Bearer — Basic doesn't apply to a JWT). */
export type AzureDevOpsCredentialScheme = 'pat' | 'oauth';

export class AzureDevOpsClient implements ForgeClient {
  /** Set by `getAuthenticatedLogin` (always called once before the closed-PR list, per `LaunchpadViewProvider`) — the GUID `searchCriteria.creatorId` needs, which the shared `ForgeClient` interface has no other way to hand `listRecentlyClosedPullRequests`. */
  private authenticatedUserId: string | undefined;

  constructor(
    private readonly identity: string,
    private readonly token: string,
    private readonly credentialScheme: AzureDevOpsCredentialScheme = 'pat',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAuthenticatedLogin(): Promise<string | null> {
    const id = splitAzureDevOpsIdentity(this.identity);
    const url = id
      ? `https://vssps.dev.azure.com/${id.organization}/_apis/profile/profiles/me?api-version=7.1`
      : 'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1';
    const res = await this.request(url);
    const data = (await res.json()) as AzureDevOpsProfile;
    this.authenticatedUserId = data.id;
    return data.emailAddress ?? data.displayName ?? null;
  }

  async listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      return [];
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    // Throws rather than soft-degrading to [] — a credential that's valid for the vssps profile
    // check but lacks "Code" scope for this endpoint (a real, easy-to-hit PAT-setup mistake) would
    // otherwise render as an indistinguishable-from-genuinely-empty board with zero signal.
    const listRes = await this.request(`${base}/pullrequests?searchCriteria.status=active&api-version=7.1`);
    const data = (await listRes.json()) as AzureDevOpsListResponse<AzureDevOpsPullRequest>;
    return Promise.all(data.value.map((pr) => this.enrich(repo, id, base, pr)));
  }

  async listRecentlyClosedPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      return [];
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    // Azure DevOps calls a closed-without-merging PR "abandoned" — completed/abandoned are
    // separate status values, same as GitLab's merged/closed split.
    const [completed, abandoned] = await Promise.all([
      this.fetchClosedList(repo, id, base, 'completed', true),
      this.fetchClosedList(repo, id, base, 'abandoned', false),
    ]);
    return [...completed, ...abandoned];
  }

  private async fetchClosedList(
    repo: ForgeRepoRef,
    id: { organization: string; project: string; repository: string },
    base: string,
    status: 'completed' | 'abandoned',
    merged: boolean,
  ): Promise<PullRequestSummary[]> {
    // Filtered server-side by creatorId, not fetched-then-filtered client-side: this repo's most
    // recently closed PRs project-wide would otherwise push the current user's own older ones
    // out of the $top window before `categorizeClosedPullRequests` ever gets to filter by author.
    const creatorFilter = this.authenticatedUserId ? `&searchCriteria.creatorId=${this.authenticatedUserId}` : '';
    // Throws rather than soft-degrading to [] — same reasoning as the open-PR list: a credential
    // problem here should never look identical to "you genuinely have no closed PRs".
    const res = await this.request(`${base}/pullrequests?searchCriteria.status=${status}${creatorFilter}&$top=10&api-version=7.1`);
    const data = (await res.json()) as AzureDevOpsListResponse<AzureDevOpsPullRequest>;
    return data.value.map((pr) => ({
      repo,
      number: pr.pullRequestId,
      title: pr.title,
      url: `https://dev.azure.com/${id.organization}/${id.project}/_git/${id.repository}/pullrequest/${pr.pullRequestId}`,
      authorLogin: loginOf(pr.createdBy),
      isDraft: false,
      createdAt: pr.creationDate,
      updatedAt: pr.closedDate ?? pr.creationDate,
      requestedReviewers: [],
      checkStatus: 'none',
      reviewDecision: 'none',
      hasConflicts: false,
      closedAt: pr.closedDate ?? pr.creationDate,
      merged,
    }));
  }

  async closePullRequest(repo: ForgeRepoRef, number: number): Promise<void> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      throw new Error('could not resolve this repo\'s Azure DevOps organization/project/repository identity');
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    await this.request(`${base}/pullrequests/${number}?api-version=7.1`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'abandoned' }),
    });
  }

  /**
   * Azure DevOps has no endpoint that returns diff text — only structured changed-item lists
   * (`iterations/{n}/changes`), which would need diffing raw file content client-side to produce
   * hunks, and this codebase doesn't bundle a diff library for that (nor should it, for one host's
   * gap). Returns the changed file paths with `insertions`/`deletions` at `0` (unknown, not "no
   * changes" — see `PullRequestDiff`) and no diff text; `renderFileSections` already shows "No
   * textual diff for this file" per file when hunks are empty, so this degrades honestly rather
   * than fabricating numbers.
   */
  async getPullRequestDiff(repo: ForgeRepoRef, number: number): Promise<PullRequestDiff> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      return { files: [], diff: '' };
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    const iterationsRes = await this.request(`${base}/pullrequests/${number}/iterations?api-version=7.1`);
    const iterations = (await iterationsRes.json()) as AzureDevOpsListResponse<AzureDevOpsIteration>;
    const latest = iterations.value.at(-1);
    if (!latest) {
      return { files: [], diff: '' };
    }
    const changesRes = await this.request(`${base}/pullrequests/${number}/iterations/${latest.id}/changes?api-version=7.1`);
    const changes = (await changesRes.json()) as AzureDevOpsIterationChanges;
    const files: FileChange[] = changes.changeEntries.map((entry) => ({
      // Azure DevOps paths are repo-root-absolute ("/src/foo.ts") — every other host's paths have
      // no leading slash, so this strips it for a consistent look in the shared file-list renderer.
      path: entry.item.path.replace(/^\//, ''),
      insertions: 0,
      deletions: 0,
      binary: false,
    }));
    return { files, diff: '' };
  }

  /** The reviewer being voted on is the authenticated user themselves — reuses the same `authenticatedUserId` `getAuthenticatedLogin` already caches for `searchCriteria.creatorId` (`AzureDevOpsClient.ts` constructor field), rather than a second profile lookup. */
  async submitReview(repo: ForgeRepoRef, number: number, decision: ReviewSubmission): Promise<void> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      throw new Error('could not resolve this repo\'s Azure DevOps organization/project/repository identity');
    }
    if (!this.authenticatedUserId) {
      throw new Error('not signed in yet — refresh Launchpad and try again');
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    await this.request(`${base}/pullrequests/${number}/reviewers/${this.authenticatedUserId}?api-version=7.1`, {
      method: 'PUT',
      body: JSON.stringify({ vote: decision === 'approve' ? 10 : -10 }),
    });
  }

  /** Azure DevOps models a standalone PR comment as a new single-comment thread — `parentCommentId: 0` and `commentType: 1` ("text") match the documented shape exactly, confirmed against the REST docs' own "Comment on the pull request" example. `status: 1` ("active") is required even for a thread with no file/line context. */
  async addComment(repo: ForgeRepoRef, number: number, body: string): Promise<void> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      throw new Error('could not resolve this repo\'s Azure DevOps organization/project/repository identity');
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    await this.request(`${base}/pullrequests/${number}/threads?api-version=7.1`, {
      method: 'POST',
      body: JSON.stringify({ comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 }),
    });
  }

  /** Excludes deleted threads and system-generated ones (vote-change notifications, etc. — `commentType: 'system'`) so this only ever lists genuine review conversations. */
  async listConversationThreads(repo: ForgeRepoRef, number: number): Promise<ConversationThread[]> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      return [];
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    const res = await this.request(`${base}/pullrequests/${number}/threads?api-version=7.1`);
    const data = (await res.json()) as AzureDevOpsListResponse<AzureDevOpsThread>;
    return data.value
      .filter((t) => !t.isDeleted && t.comments[0]?.commentType !== 'system')
      .map((t) => ({
        id: String(t.id),
        body: t.comments[0]?.content ?? '',
        authorLogin: t.comments[0] ? loginOf(t.comments[0].author) : '',
        resolved: !UNRESOLVED_STATUSES.has(t.status),
      }));
  }

  /** `"fixed"` is sent as its enum name, not a numeric ordinal — Azure DevOps' own docs and examples for this endpoint use the string form on write, matching what it always returns on read. */
  async resolveConversationThread(repo: ForgeRepoRef, number: number, threadId: string): Promise<void> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      throw new Error('could not resolve this repo\'s Azure DevOps organization/project/repository identity');
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    await this.request(`${base}/pullrequests/${number}/threads/${threadId}?api-version=7.1`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'fixed' }),
    });
  }

  private async enrich(
    repo: ForgeRepoRef,
    id: { organization: string; project: string; repository: string },
    base: string,
    pr: AzureDevOpsPullRequest,
  ): Promise<PullRequestSummary> {
    const statuses = pr.lastMergeSourceCommit ? await this.fetchStatuses(base, pr.pullRequestId) : [];
    const { requestedReviewers, reviewDecision } = reviewersInfo(pr.reviewers ?? []);
    return {
      repo,
      number: pr.pullRequestId,
      title: pr.title,
      url: `https://dev.azure.com/${id.organization}/${id.project}/_git/${id.repository}/pullrequest/${pr.pullRequestId}`,
      authorLogin: loginOf(pr.createdBy),
      isDraft: pr.isDraft ?? false,
      createdAt: pr.creationDate,
      updatedAt: pr.creationDate,
      requestedReviewers,
      checkStatus: computeCheckStatus(statuses),
      reviewDecision,
      hasConflicts: pr.mergeStatus === 'conflicts',
    };
  }

  private async fetchStatuses(base: string, pullRequestId: number): Promise<AzureDevOpsStatus[]> {
    const res = await this.requestOrNull(`${base}/pullRequests/${pullRequestId}/statuses?api-version=7.1`);
    if (!res) {
      return [];
    }
    const data = (await res.json()) as AzureDevOpsListResponse<AzureDevOpsStatus>;
    return data.value ?? [];
  }

  /** Throws with the real reason (HTTP status or network failure) instead of swallowing it. Only `fetchStatuses` wraps this in `requestOrNull` — a single PR's check-status enrichment failing shouldn't take down the whole list the way a credential problem on the list call itself should be visible. */
  private async request(url: string, init?: RequestInit): Promise<Response> {
    // A PAT authenticates via HTTP Basic with an empty username — Bearer support for raw PATs
    // isn't consistently documented the way it is for GitHub/GitLab/Bitbucket tokens. An AAD OAuth
    // access token (from the built-in Microsoft session) is the opposite: it's a JWT, so it only
    // ever goes as a Bearer token — Basic doesn't apply to it at all.
    const authHeader =
      this.credentialScheme === 'oauth' ? `Bearer ${this.token}` : `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: {
          Authorization: authHeader,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch (err) {
      throw new Error(`couldn't reach ${new URL(url).host}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
    }
    return res;
  }

  /** Network failure, DNS failure, non-2xx, etc. — degrade to "nothing here" rather than throwing partway through a board render. */
  private async requestOrNull(url: string): Promise<Response | null> {
    try {
      return await this.request(url);
    } catch {
      return null;
    }
  }
}
