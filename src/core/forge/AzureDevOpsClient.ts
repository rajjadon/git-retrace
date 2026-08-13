import type { ForgeClient } from './ForgeClient';
import { splitAzureDevOpsIdentity } from './azureDevOpsIdentity';
import type { CheckStatus, ForgeRepoRef, PullRequestSummary, ReviewDecision } from './types';

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
  emailAddress?: string;
  displayName?: string;
}

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
 * The identity ("who am I") check lives on a *different* host (`app.vssps.visualstudio.com`) than
 * the main API (`dev.azure.com`) — a genuine, well-documented Azure DevOps quirk, not a mistake
 * here. PR authors/reviewers are matched by `uniqueName` (their email/UPN), the same value the
 * profile API returns as `emailAddress`.
 */
export class AzureDevOpsClient implements ForgeClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAuthenticatedLogin(): Promise<string | null> {
    const res = await this.request('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1');
    if (!res) {
      return null;
    }
    const data = (await res.json()) as AzureDevOpsProfile;
    return data.emailAddress ?? data.displayName ?? null;
  }

  async listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      return [];
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    const listRes = await this.request(`${base}/pullrequests?searchCriteria.status=active&api-version=7.1`);
    if (!listRes) {
      return [];
    }
    const data = (await listRes.json()) as AzureDevOpsListResponse<AzureDevOpsPullRequest>;
    return Promise.all(data.value.map((pr) => this.enrich(repo, id, base, pr)));
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
    const res = await this.request(`${base}/pullRequests/${pullRequestId}/statuses?api-version=7.1`);
    if (!res) {
      return [];
    }
    const data = (await res.json()) as AzureDevOpsListResponse<AzureDevOpsStatus>;
    return data.value ?? [];
  }

  private async request(url: string): Promise<Response | null> {
    try {
      // Azure DevOps PATs authenticate via HTTP Basic with an empty username — Bearer support for
      // raw PATs isn't consistently documented the way it is for GitHub/GitLab/Bitbucket tokens.
      const basic = Buffer.from(`:${this.token}`).toString('base64');
      const res = await this.fetchImpl(url, { headers: { Authorization: `Basic ${basic}` } });
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }
}
