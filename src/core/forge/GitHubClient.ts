import type { FileChange } from '../git/types';
import type { ForgeClient } from './ForgeClient';
import type { CheckStatus, ConversationThread, ForgeRepoRef, MergeOptions, PullRequestDiff, PullRequestSummary, ReviewDecision, ReviewSubmission } from './types';
import { describeErrorBody } from './httpError';

/** Fetches up to 100 review threads and each one's first comment — enough to identify and resolve a conversation without paginating replies nobody asked to see. */
const REVIEW_THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          originalLine
          comments(first: 1) {
            nodes {
              body
              author { login }
            }
          }
        }
      }
    }
  }
}`;

const RESOLVE_REVIEW_THREAD_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

interface GitHubReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: Array<{
          id: string;
          isResolved: boolean;
          path: string;
          /** Null once the thread's commit is no longer part of the PR (an outdated/superseded diff) — `originalLine` is always set for a line comment, so it's the fallback. */
          line: number | null;
          originalLine: number | null;
          comments: { nodes: Array<{ body: string; author: { login: string } | null }> };
        }>;
      };
    };
  };
}

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

interface GitHubPullFile {
  filename: string;
  additions: number;
  deletions: number;
  /** Absent for binary files and files too large to diff — GitHub's own signal for "no textual diff", reused directly as `FileChange.binary`. */
  patch?: string;
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
    const listRes = await this.request(`/repos/${repo.identity}/pulls?state=open&per_page=100`);
    const raw = (await listRes.json()) as GitHubPull[];
    return Promise.all(raw.map((pull) => this.enrich(repo, pull)));
  }

  async listRecentlyClosedPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    // GitHub's one "closed" state covers both merged and closed-without-merging — `merged_at`
    // (present only on merged ones) is what tells the two apart. No server-side "authored by me"
    // filter here (unlike GitLab/Bitbucket/Azure DevOps): the REST pulls endpoint has no author
    // param, and the one that does (the Search API) has a much tighter rate limit (30/min) that a
    // multi-repo board refreshing repeatedly could burn through fast — `per_page=100` (the max)
    // is the safer mitigation for the same "your own older PRs got pushed out of the window"
    // truncation risk, even though it's not a complete server-side fix the way the other hosts get.
    const listRes = await this.request(`/repos/${repo.identity}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
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

  /** GitHub refuses this with a real 422 if the PR's head branch or fork no longer exists — that's a legitimate failure the caller surfaces as-is, not something to detect ahead of time. */
  async reopenPullRequest(repo: ForgeRepoRef, number: number): Promise<void> {
    await this.request(`/repos/${repo.identity}/pulls/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'open' }),
    });
  }

  /** GitHub's `application/vnd.github.v3.diff` media type returns the whole PR's unified diff as plain text directly — no reconstruction needed, unlike GitLab. */
  async getPullRequestDiff(repo: ForgeRepoRef, number: number): Promise<PullRequestDiff> {
    const [diffRes, filesRes] = await Promise.all([
      this.request(`/repos/${repo.identity}/pulls/${number}`, { headers: { Accept: 'application/vnd.github.v3.diff' } }),
      this.request(`/repos/${repo.identity}/pulls/${number}/files?per_page=100`),
    ]);
    const diff = await diffRes.text();
    const rawFiles = (await filesRes.json()) as GitHubPullFile[];
    const files: FileChange[] = rawFiles.map((f) => ({
      path: f.filename,
      insertions: f.additions,
      deletions: f.deletions,
      binary: f.patch === undefined,
    }));
    return { files, diff };
  }

  async submitReview(repo: ForgeRepoRef, number: number, decision: ReviewSubmission): Promise<void> {
    await this.request(`/repos/${repo.identity}/pulls/${number}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ event: decision === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES' }),
    });
  }

  /** PRs are issues for comment purposes on GitHub — there's no separate "PR comment" endpoint. */
  async addComment(repo: ForgeRepoRef, number: number, body: string): Promise<void> {
    await this.request(`/repos/${repo.identity}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /**
   * GitHub has no REST endpoint for review threads at all — only the GraphQL `reviewThreads`
   * connection (see `graphql()`, a second request path alongside the REST `request()` this class
   * otherwise exclusively uses).
   */
  async listConversationThreads(repo: ForgeRepoRef, number: number): Promise<ConversationThread[]> {
    const [owner, name] = repo.identity.split('/');
    const data = await this.graphql<GitHubReviewThreadsResponse>(REVIEW_THREADS_QUERY, { owner, name, number });
    return data.repository.pullRequest.reviewThreads.nodes.map((thread) => {
      const comment = thread.comments.nodes[0];
      const line = thread.line ?? thread.originalLine ?? undefined;
      return {
        id: thread.id,
        body: comment?.body ?? '',
        authorLogin: comment?.author?.login ?? '',
        resolved: thread.isResolved,
        ...(thread.path !== undefined ? { file: thread.path } : {}),
        ...(line !== undefined ? { line } : {}),
      };
    });
  }

  /** `resolveReviewThread` — the GraphQL mutation counterpart to `reviewThreads`; same reasoning as `listConversationThreads` for why this isn't a REST call. */
  async resolveConversationThread(_repo: ForgeRepoRef, _number: number, threadId: string): Promise<void> {
    await this.graphql(RESOLVE_REVIEW_THREAD_MUTATION, { threadId });
  }

  /** `merge_method` maps directly to GitHub's own three strategies. Deleting the source branch is a separate call — GitHub's merge endpoint has no option for it — so it only fetches the head ref (one extra GET) when actually requested. */
  async mergePullRequest(repo: ForgeRepoRef, number: number, options: MergeOptions): Promise<void> {
    await this.request(`/repos/${repo.identity}/pulls/${number}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ merge_method: options.strategy }),
    });
    if (options.deleteSourceBranch) {
      const branch = await this.fetchHeadBranch(repo, number);
      if (branch) {
        await this.request(`/repos/${repo.identity}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' });
      }
    }
  }

  /** Best-effort: if this fails, the merge itself already succeeded, so the caller just keeps the source branch around rather than failing an otherwise-successful merge over branch cleanup. */
  private async fetchHeadBranch(repo: ForgeRepoRef, number: number): Promise<string | undefined> {
    const res = await this.requestOrNull(`/repos/${repo.identity}/pulls/${number}`);
    if (!res) {
      return undefined;
    }
    const data = (await res.json()) as { head?: { ref?: string } };
    return data.head?.ref;
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

  /** Throws with the real reason (HTTP status or network failure) instead of swallowing it. Only the per-PR enrichment calls (`fetchReviews`, `fetchCheckRuns`, `fetchMergeableState`) wrap this in `requestOrNull` — one PR's extra data failing to load shouldn't take down the whole list the way a credential problem on the list call itself should be visible. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    // `graphql()` passes a full absolute URL (GraphQL lives at a different host path than REST,
    // see `graphqlUrl()`) — everything else here passes a relative path against `apiBaseUrl`.
    const url = /^https?:\/\//.test(path) ? path : `${this.apiBaseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          // Last, so a caller-supplied Accept (e.g. the raw-diff media type) wins over the default.
          ...init?.headers,
        },
      });
    } catch (err) {
      throw new Error(`couldn't reach ${new URL(url).host}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const detail = describeErrorBody(await res.text());
      throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}${detail ? `: ${detail}` : ''}`);
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

  /**
   * REST lives at `{apiBaseUrl}{path}`; GraphQL is a wholly different endpoint, not a REST path —
   * `api.github.com`'s is `/graphql`, and a GitHub Enterprise Server instance's REST base
   * (`<host>/api/v3`) maps to `<host>/api/graphql`, not `<host>/api/v3/graphql`.
   */
  private graphqlUrl(): string {
    if (this.apiBaseUrl === 'https://api.github.com') {
      return 'https://api.github.com/graphql';
    }
    return this.apiBaseUrl.replace(/\/api\/v3\/?$/, '/api/graphql');
  }

  /**
   * GraphQL returns `200 OK` even when the query itself failed — errors live in an `errors` array
   * in the body, not the HTTP status — so this checks for that explicitly rather than trusting
   * `request()`'s ok-status check alone.
   */
  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.request(this.graphqlUrl(), { method: 'POST', body: JSON.stringify({ query, variables }) });
    const data = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (data.errors && data.errors.length > 0) {
      throw new Error(data.errors.map((e) => e.message).join('; '));
    }
    if (!data.data) {
      throw new Error('GitHub GraphQL API returned no data');
    }
    return data.data;
  }
}
