import type { ForgeClient } from './ForgeClient';
import type { CheckStatus, ForgeRepoRef, PullRequestSummary, ReviewDecision } from './types';

interface BitbucketUser {
  username?: string;
  nickname?: string;
}

interface BitbucketParticipant {
  user: BitbucketUser;
  role: 'REVIEWER' | 'PARTICIPANT';
  approved: boolean;
  state: 'approved' | 'changes_requested' | null;
}

interface BitbucketPullRequest {
  id: number;
  title: string;
  links: { html: { href: string } };
  author: BitbucketUser | null;
  draft?: boolean;
  created_on: string;
  updated_on: string;
  participants?: BitbucketParticipant[];
  source: { commit: { hash: string } };
}

interface BitbucketPage<T> {
  values: T[];
}

interface BitbucketBuildStatus {
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED';
}

function loginOf(user: BitbucketUser | null | undefined): string {
  return user?.username ?? user?.nickname ?? '';
}

function computeCheckStatus(statuses: BitbucketBuildStatus[]): CheckStatus {
  if (statuses.length === 0) {
    return 'none';
  }
  if (statuses.some((s) => s.state === 'INPROGRESS')) {
    return 'pending';
  }
  if (statuses.some((s) => s.state === 'FAILED' || s.state === 'STOPPED')) {
    return 'failing';
  }
  return 'passing';
}

/**
 * Bitbucket's PR object already carries per-reviewer approval state in its own `participants`
 * array (`approved`/`state`), unlike GitHub — no separate reviews call needed.
 */
function reviewersInfo(pr: BitbucketPullRequest): { requestedReviewers: string[]; reviewDecision: ReviewDecision } {
  const reviewers = (pr.participants ?? []).filter((p) => p.role === 'REVIEWER');
  if (reviewers.some((r) => r.state === 'changes_requested')) {
    return { requestedReviewers: reviewers.filter((r) => !r.approved).map((r) => loginOf(r.user)), reviewDecision: 'changesRequested' };
  }
  const stillOwed = reviewers.filter((r) => !r.approved).map((r) => loginOf(r.user));
  if (stillOwed.length > 0) {
    return { requestedReviewers: stillOwed, reviewDecision: 'reviewRequired' };
  }
  if (reviewers.length > 0) {
    return { requestedReviewers: [], reviewDecision: 'approved' };
  }
  return { requestedReviewers: [], reviewDecision: 'none' };
}

/**
 * The only place that talks to Bitbucket Cloud's REST API 2.0. Uses Bitbucket's newer Access
 * Token model (Bearer auth), not the legacy App Password (HTTP Basic, username+password pair) —
 * keeps the credential shape a single string, consistent with every other `ForgeClient`.
 *
 * `hasConflicts` is always `false`: Bitbucket's PR object doesn't expose mergeability without an
 * actual merge-preview attempt, which isn't a clean read the way GitHub's `mergeable_state` or
 * GitLab's `has_conflicts` are. Documented gap, not a silent guess.
 */
export class BitbucketClient implements ForgeClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAuthenticatedLogin(): Promise<string | null> {
    const res = await this.request('/user');
    if (!res) {
      return null;
    }
    const data = (await res.json()) as BitbucketUser;
    const login = loginOf(data);
    return login || null;
  }

  async listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const listRes = await this.request(`/repositories/${repo.identity}/pullrequests?state=OPEN`);
    if (!listRes) {
      return [];
    }
    const page = (await listRes.json()) as BitbucketPage<BitbucketPullRequest>;
    return Promise.all(page.values.map((pr) => this.enrich(repo, pr)));
  }

  private async enrich(repo: ForgeRepoRef, pr: BitbucketPullRequest): Promise<PullRequestSummary> {
    const statuses = await this.fetchBuildStatuses(repo, pr.source.commit.hash);
    const { requestedReviewers, reviewDecision } = reviewersInfo(pr);
    return {
      repo,
      number: pr.id,
      title: pr.title,
      url: pr.links.html.href,
      authorLogin: loginOf(pr.author),
      isDraft: pr.draft ?? false,
      createdAt: pr.created_on,
      updatedAt: pr.updated_on,
      requestedReviewers,
      checkStatus: computeCheckStatus(statuses),
      reviewDecision,
      hasConflicts: false,
    };
  }

  private async fetchBuildStatuses(repo: ForgeRepoRef, revision: string): Promise<BitbucketBuildStatus[]> {
    const res = await this.request(`/repositories/${repo.identity}/commit/${revision}/statuses`);
    if (!res) {
      return [];
    }
    const page = (await res.json()) as BitbucketPage<BitbucketBuildStatus>;
    return page.values ?? [];
  }

  private async request(path: string): Promise<Response | null> {
    try {
      const res = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }
}
