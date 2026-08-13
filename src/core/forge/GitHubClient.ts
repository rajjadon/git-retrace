import type { ForgeClient } from './ForgeClient';
import type { CheckStatus, ForgeRepoRef, PullRequestSummary, ReviewDecision } from './types';

interface GitHubUser {
  login: string;
}

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  user: GitHubUser | null;
  draft?: boolean;
  created_at: string;
  updated_at: string;
  requested_reviewers?: GitHubUser[];
  head: { sha: string };
}

/** Only present on `state=closed` results — `merged_at` is non-null exactly when the PR was merged rather than closed without merging. */
interface GitHubClosedPull extends GitHubPull {
  closed_at: string | null;
  merged_at: string | null;
}

interface GitHubReview {
  user: GitHubUser | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submitted_at?: string;
}

interface GitHubCheckRun {
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'stale' | null;
}

/** Last review per user wins — GitHub returns reviews in submission order, so the last occurrence for a given login is their current standing. */
function latestReviewPerUser(reviews: GitHubReview[]): GitHubReview[] {
  const byUser = new Map<string, GitHubReview>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (login) {
      byUser.set(login, review);
    }
  }
  return [...byUser.values()];
}

function computeReviewDecision(reviews: GitHubReview[], requestedReviewers: string[]): ReviewDecision {
  const latest = latestReviewPerUser(reviews);
  if (latest.some((r) => r.state === 'CHANGES_REQUESTED')) {
    return 'changesRequested';
  }
  if (requestedReviewers.length > 0) {
    return 'reviewRequired';
  }
  if (latest.some((r) => r.state === 'APPROVED')) {
    return 'approved';
  }
  return 'none';
}

const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);

function computeCheckStatus(checkRuns: GitHubCheckRun[]): CheckStatus {
  if (checkRuns.length === 0) {
    return 'none';
  }
  if (checkRuns.some((run) => run.status !== 'completed')) {
    return 'pending';
  }
  if (checkRuns.some((run) => run.conclusion !== null && FAILING_CONCLUSIONS.has(run.conclusion))) {
    return 'failing';
  }
  return 'passing';
}

/**
 * The only place that talks to GitHub's REST API — same "one boundary" discipline as `GitService`
 * for git itself. `apiBaseUrl` is a constructor parameter, not hardcoded to `api.github.com`, so a
 * GitHub Enterprise Server instance (or Gitea/Forgejo, which speak a GitHub-compatible API) reuses
 * this client unchanged, just pointed at its own base URL via `gitLore.launchpad.customHosts`.
 */
export class GitHubClient implements ForgeClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAuthenticatedLogin(): Promise<string | null> {
    const res = await this.request('/user');
    const data = (await res.json()) as GitHubUser;
    return data.login ?? null;
  }

  async listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const listRes = await this.requestOrNull(`/repos/${repo.identity}/pulls?state=open&per_page=100`);
    if (!listRes) {
      return [];
    }
    const raw = (await listRes.json()) as GitHubPull[];
    return Promise.all(raw.map((pull) => this.enrich(repo, pull)));
  }

  async listRecentlyClosedPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    // GitHub's one "closed" state covers both merged and closed-without-merging — `merged_at`
    // (present only on merged ones) is what tells the two apart.
    const listRes = await this.requestOrNull(`/repos/${repo.identity}/pulls?state=closed&sort=updated&direction=desc&per_page=20`);
    if (!listRes) {
      return [];
    }
    const raw = (await listRes.json()) as GitHubClosedPull[];
    return raw.map((pull) => ({
      repo,
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      authorLogin: pull.user?.login ?? '',
      isDraft: pull.draft ?? false,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      requestedReviewers: [],
      checkStatus: 'none',
      reviewDecision: 'none',
      hasConflicts: false,
      closedAt: pull.closed_at ?? pull.updated_at,
      merged: pull.merged_at !== null,
    }));
  }

  async closePullRequest(repo: ForgeRepoRef, number: number): Promise<void> {
    await this.request(`/repos/${repo.identity}/pulls/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    });
  }

  private async enrich(repo: ForgeRepoRef, pull: GitHubPull): Promise<PullRequestSummary> {
    const [reviews, checkRuns, mergeableState] = await Promise.all([
      this.fetchReviews(repo, pull.number),
      this.fetchCheckRuns(repo, pull.head.sha),
      this.fetchMergeableState(repo, pull.number),
    ]);
    const requestedReviewers = (pull.requested_reviewers ?? []).map((u) => u.login);
    return {
      repo,
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      authorLogin: pull.user?.login ?? '',
      isDraft: pull.draft ?? false,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      requestedReviewers,
      checkStatus: computeCheckStatus(checkRuns),
      reviewDecision: computeReviewDecision(reviews, requestedReviewers),
      hasConflicts: mergeableState === 'dirty',
    };
  }

  private async fetchReviews(repo: ForgeRepoRef, prNumber: number): Promise<GitHubReview[]> {
    const res = await this.requestOrNull(`/repos/${repo.identity}/pulls/${prNumber}/reviews?per_page=100`);
    return res ? ((await res.json()) as GitHubReview[]) : [];
  }

  private async fetchCheckRuns(repo: ForgeRepoRef, sha: string): Promise<GitHubCheckRun[]> {
    const res = await this.requestOrNull(`/repos/${repo.identity}/commits/${sha}/check-runs?per_page=100`);
    if (!res) {
      return [];
    }
    const data = (await res.json()) as { check_runs: GitHubCheckRun[] };
    return data.check_runs ?? [];
  }

  /**
   * `mergeable_state` only appears on the single-PR endpoint (not the list), and GitHub computes
   * it asynchronously — a fresh PR can report `null` ("still checking") for a few seconds. Treated
   * the same as "unknown, no conflicts" rather than polling for it to settle.
   */
  private async fetchMergeableState(repo: ForgeRepoRef, prNumber: number): Promise<string | null> {
    const res = await this.requestOrNull(`/repos/${repo.identity}/pulls/${prNumber}`);
    if (!res) {
      return null;
    }
    const data = (await res.json()) as { mergeable_state?: string | null };
    return data.mergeable_state ?? null;
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
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
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
