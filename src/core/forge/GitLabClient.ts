import type { ForgeClient } from './ForgeClient';
import type { CheckStatus, ForgeRepoRef, PullRequestSummary, ReviewDecision } from './types';

interface GitLabUser {
  username: string;
}

interface GitLabPipeline {
  status: 'success' | 'failed' | 'canceled' | 'skipped' | 'running' | 'pending' | 'created' | 'waiting_for_resource' | 'preparing' | string;
}

interface GitLabMergeRequest {
  iid: number;
  title: string;
  web_url: string;
  author: GitLabUser | null;
  draft?: boolean;
  work_in_progress?: boolean;
  created_at: string;
  updated_at: string;
  reviewers?: GitLabUser[];
  has_conflicts?: boolean;
  blocking_discussions_resolved?: boolean;
  head_pipeline?: GitLabPipeline | null;
}

interface GitLabApprovals {
  approved: boolean;
  approved_by: Array<{ user: GitLabUser }>;
}

const PASSING_STATUSES = new Set(['success', 'skipped']);
const FAILING_STATUSES = new Set(['failed', 'canceled']);

function computeCheckStatus(pipeline: GitLabPipeline | null | undefined): CheckStatus {
  if (!pipeline) {
    return 'none';
  }
  if (PASSING_STATUSES.has(pipeline.status)) {
    return 'passing';
  }
  if (FAILING_STATUSES.has(pipeline.status)) {
    return 'failing';
  }
  return 'pending';
}

/**
 * GitLab has no direct "changes requested" review state the way GitHub does — reviewers leave
 * comments/discussions instead. `blocking_discussions_resolved: false` (a required discussion
 * thread still open) is the closest real signal for "someone asked for something and it isn't
 * addressed yet", so that's what maps to `changesRequested` here.
 */
function computeReviewDecision(mr: GitLabMergeRequest, approved: boolean, reviewers: string[]): ReviewDecision {
  if (mr.blocking_discussions_resolved === false) {
    return 'changesRequested';
  }
  if (approved) {
    return 'approved';
  }
  if (reviewers.length > 0) {
    return 'reviewRequired';
  }
  return 'none';
}

/**
 * The only place that talks to GitLab's REST API v4. `apiBaseUrl` is a constructor parameter, not
 * hardcoded to `gitlab.com`, so a self-hosted GitLab CE/EE instance reuses this client unchanged,
 * just pointed at its own base URL via `gitLore.launchpad.customHosts`.
 */
export class GitLabClient implements ForgeClient {
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
    const data = (await res.json()) as GitLabUser;
    return data.username ?? null;
  }

  async listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const projectPath = encodeURIComponent(repo.identity);
    const listRes = await this.request(`/projects/${projectPath}/merge_requests?state=opened&per_page=100`);
    if (!listRes) {
      return [];
    }
    const raw = (await listRes.json()) as GitLabMergeRequest[];
    return Promise.all(raw.map((mr) => this.enrich(repo, projectPath, mr)));
  }

  private async enrich(repo: ForgeRepoRef, projectPath: string, mr: GitLabMergeRequest): Promise<PullRequestSummary> {
    const approvals = await this.fetchApprovals(projectPath, mr.iid);
    const approvedByUsernames = new Set(approvals.approved_by.map((a) => a.user.username));
    const reviewers = (mr.reviewers ?? []).map((u) => u.username);
    // Only a reviewer who has personally approved is removed from "still owed" — matches
    // GitHub's requested_reviewers semantics (per-person, not an all-or-nothing MR-level flag),
    // since someone else's approval satisfying the overall requirement doesn't mean *this*
    // reviewer weighed in.
    const stillOwed = reviewers.filter((username) => !approvedByUsernames.has(username));
    return {
      repo,
      number: mr.iid,
      title: mr.title,
      url: mr.web_url,
      authorLogin: mr.author?.username ?? '',
      isDraft: mr.draft ?? mr.work_in_progress ?? false,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      requestedReviewers: stillOwed,
      checkStatus: computeCheckStatus(mr.head_pipeline),
      reviewDecision: computeReviewDecision(mr, approvals.approved, stillOwed),
      hasConflicts: mr.has_conflicts ?? false,
    };
  }

  private async fetchApprovals(projectPath: string, iid: number): Promise<GitLabApprovals> {
    const res = await this.request(`/projects/${projectPath}/merge_requests/${iid}/approvals`);
    if (!res) {
      return { approved: false, approved_by: [] };
    }
    const data = (await res.json()) as GitLabApprovals;
    return { approved: data.approved ?? false, approved_by: data.approved_by ?? [] };
  }

  private async request(path: string): Promise<Response | null> {
    try {
      const res = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        headers: { 'PRIVATE-TOKEN': this.token },
      });
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }
}
