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
    const data = (await res.json()) as BitbucketUser;
    const login = loginOf(data);
    return login || null;
  }

  async listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const listRes = await this.requestOrNull(`/repositories/${repo.identity}/pullrequests?state=OPEN`);
    if (!listRes) {
      return [];
    }
    const page = (await listRes.json()) as BitbucketPage<BitbucketPullRequest>;
    return Promise.all(page.values.map((pr) => this.enrich(repo, pr)));
  }

  async listRecentlyClosedPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    // Bitbucket calls a closed-without-merging PR "declined" — MERGED and DECLINED are separate
    // state values, same as GitLab's merged/closed split.
    const [merged, declined] = await Promise.all([
      this.fetchClosedList(repo, 'MERGED', true),
      this.fetchClosedList(repo, 'DECLINED', false),
    ]);
    return [...merged, ...declined];
  }

  private async fetchClosedList(repo: ForgeRepoRef, state: 'MERGED' | 'DECLINED', merged: boolean): Promise<PullRequestSummary[]> {
    const res = await this.requestOrNull(`/repositories/${repo.identity}/pullrequests?state=${state}`);
    if (!res) {
      return [];
    }
    const page = (await res.json()) as BitbucketPage<BitbucketPullRequest>;
    return page.values.slice(0, 10).map((pr) => ({
      repo,
      number: pr.id,
      title: pr.title,
      url: pr.links.html.href,
      authorLogin: loginOf(pr.author),
      isDraft: false,
      createdAt: pr.created_on,
      updatedAt: pr.updated_on,
      requestedReviewers: [],
      checkStatus: 'none',
      reviewDecision: 'none',
      hasConflicts: false,
      closedAt: pr.updated_on,
      merged,
    }));
  }

  async closePullRequest(repo: ForgeRepoRef, number: number): Promise<void> {
    await this.request(`/repositories/${repo.identity}/pullrequests/${number}/decline`, { method: 'POST' });
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
    const res = await this.requestOrNull(`/repositories/${repo.identity}/commit/${revision}/statuses`);
    if (!res) {
      return [];
    }
    const page = (await res.json()) as BitbucketPage<BitbucketBuildStatus>;
    return page.values ?? [];
  }

  /** Throws with the real reason (HTTP status or network failure) instead of swallowing it — every caller except `getAuthenticatedLogin` wraps this in `requestOrNull` to keep their existing soft-degrade behavior. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.apiBaseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
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
  private async requestOrNull(path: string): Promise<Response | null> {
    try {
      return await this.request(path);
    } catch {
      return null;
    }
  }
}
