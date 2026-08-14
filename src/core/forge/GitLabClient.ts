import type { FileChange } from '../git/types';
import type { ForgeClient } from './ForgeClient';
import type { CheckStatus, ConversationThread, ForgeRepoRef, PullRequestDiff, PullRequestSummary, ReviewDecision, ReviewSubmission } from './types';
import { describeErrorBody } from './httpError';

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

/** A GitLab "discussion" is the thread; `notes` are its comments. Only a `resolvable` discussion (a genuine review conversation, not a plain top-level comment) can be resolved at all. */
interface GitLabDiscussion {
  id: string;
  notes: Array<{
    body: string;
    author: GitLabUser | null;
    resolvable: boolean;
    resolved: boolean;
    /** Only present on a note attached to a specific diff line — absent for a plain discussion note. */
    position?: { new_path?: string; old_path?: string; new_line?: number | null; old_line?: number | null };
  }>;
}

interface GitLabApprovals {
  approved: boolean;
  approved_by: Array<{ user: GitLabUser }>;
}

/** GitLab's per-file diff fragment — `diff` is just the hunk body, with no `diff --git a/x b/y` header line the way a real `git diff`/GitHub's raw-diff media type has one. */
interface GitLabDiffFile {
  old_path: string;
  new_path: string;
  diff: string;
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
  /** Set by `getAuthenticatedLogin` (always called once before the closed-MR list, per `LaunchpadViewProvider`) — used to scope `fetchClosedList`'s `author_username` filter server-side. */
  private authenticatedUsername: string | undefined;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAuthenticatedLogin(): Promise<string | null> {
    const res = await this.request('/user');
    const data = (await res.json()) as GitLabUser;
    this.authenticatedUsername = data.username;
    return data.username ?? null;
  }

  async listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    const projectPath = encodeURIComponent(repo.identity);
    const listRes = await this.request(`/projects/${projectPath}/merge_requests?state=opened&per_page=100`);
    const raw = (await listRes.json()) as GitLabMergeRequest[];
    return Promise.all(raw.map((mr) => this.enrich(repo, projectPath, mr)));
  }

  async listRecentlyClosedPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]> {
    // Unlike GitHub, GitLab's `state` distinguishes "merged" from "closed" (without merging) as
    // two separate values — no single call covers both.
    const projectPath = encodeURIComponent(repo.identity);
    const [merged, closed] = await Promise.all([
      this.fetchClosedList(repo, projectPath, 'merged', true),
      this.fetchClosedList(repo, projectPath, 'closed', false),
    ]);
    return [...merged, ...closed];
  }

  private async fetchClosedList(
    repo: ForgeRepoRef,
    projectPath: string,
    state: 'merged' | 'closed',
    merged: boolean,
  ): Promise<PullRequestSummary[]> {
    // Filtered server-side by author_username, not fetched-then-filtered client-side: this
    // project's most recently closed/merged MRs project-wide would otherwise push the current
    // user's own older ones out of the `per_page` window before `categorizeClosedPullRequests`
    // ever gets to filter by author.
    const authorFilter = this.authenticatedUsername ? `&author_username=${encodeURIComponent(this.authenticatedUsername)}` : '';
    const res = await this.request(`/projects/${projectPath}/merge_requests?state=${state}${authorFilter}&order_by=updated_at&per_page=10`);
    const raw = (await res.json()) as GitLabMergeRequest[];
    return raw.map((mr) => ({
      repo,
      number: mr.iid,
      title: mr.title,
      url: mr.web_url,
      authorLogin: mr.author?.username ?? '',
      isDraft: false,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      requestedReviewers: [],
      checkStatus: 'none',
      reviewDecision: 'none',
      hasConflicts: false,
      closedAt: mr.updated_at,
      merged,
    }));
  }

  async closePullRequest(repo: ForgeRepoRef, number: number): Promise<void> {
    const projectPath = encodeURIComponent(repo.identity);
    await this.request(`/projects/${projectPath}/merge_requests/${number}`, {
      method: 'PUT',
      body: JSON.stringify({ state_event: 'close' }),
    });
  }

  /**
   * GitLab's `/diffs` endpoint returns one hunk-body fragment per file — no `diff --git a/x b/y`
   * header the way GitHub's raw-diff media type or a real `git diff` has, and no insertion/deletion
   * counts either. Synthesizing a minimal header per file (and counting `+`/`-` lines ourselves)
   * makes this combine into one string `splitDiffByFile`/`renderDiff` (`src/views/diffRender.ts`)
   * already know how to parse — that shared renderer only ever needed the header line to find each
   * file's boundary, nothing else about it.
   */
  async getPullRequestDiff(repo: ForgeRepoRef, number: number): Promise<PullRequestDiff> {
    const projectPath = encodeURIComponent(repo.identity);
    const res = await this.request(`/projects/${projectPath}/merge_requests/${number}/diffs?per_page=100`);
    const rawFiles = (await res.json()) as GitLabDiffFile[];
    const files: FileChange[] = [];
    const diffParts: string[] = [];
    for (const f of rawFiles) {
      const insertions = (f.diff.match(/^\+(?!\+\+)/gm) ?? []).length;
      const deletions = (f.diff.match(/^-(?!--)/gm) ?? []).length;
      files.push({ path: f.new_path, insertions, deletions, binary: false });
      if (f.diff) {
        diffParts.push(`diff --git a/${f.old_path} b/${f.new_path}\n${f.diff}`);
      }
    }
    return { files, diff: diffParts.join('\n') };
  }

  /** GitLab has no formal "request changes" review state the way GitHub does (see `computeReviewDecision`'s own comment on this) — there's no endpoint to call, so `'requestChanges'` throws a clear, actionable message rather than silently doing nothing or faking an approval-adjacent action GitLab doesn't have. */
  async submitReview(repo: ForgeRepoRef, number: number, decision: ReviewSubmission): Promise<void> {
    if (decision === 'requestChanges') {
      throw new Error("GitLab has no \"Request Changes\" review state — leave a comment explaining what needs to change instead");
    }
    const projectPath = encodeURIComponent(repo.identity);
    await this.request(`/projects/${projectPath}/merge_requests/${number}/approve`, { method: 'POST' });
  }

  async addComment(repo: ForgeRepoRef, number: number, body: string): Promise<void> {
    const projectPath = encodeURIComponent(repo.identity);
    await this.request(`/projects/${projectPath}/merge_requests/${number}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /** Only resolvable discussions are genuine review conversations — a plain top-level comment (e.g. from `addComment`) is its own unresolvable discussion and would just be a dead "Resolve" button if included here. */
  async listConversationThreads(repo: ForgeRepoRef, number: number): Promise<ConversationThread[]> {
    const projectPath = encodeURIComponent(repo.identity);
    const res = await this.request(`/projects/${projectPath}/merge_requests/${number}/discussions?per_page=100`);
    const discussions = (await res.json()) as GitLabDiscussion[];
    return discussions
      .filter((d) => d.notes[0]?.resolvable)
      .map((d) => {
        const position = d.notes[0]?.position;
        const file = position?.new_path ?? position?.old_path;
        const line = position?.new_line ?? position?.old_line ?? undefined;
        return {
          id: d.id,
          body: d.notes[0]?.body ?? '',
          authorLogin: d.notes[0]?.author?.username ?? '',
          resolved: d.notes[0]?.resolved ?? false,
          ...(file !== undefined ? { file } : {}),
          ...(line !== undefined ? { line } : {}),
        };
      });
  }

  async resolveConversationThread(repo: ForgeRepoRef, number: number, threadId: string): Promise<void> {
    const projectPath = encodeURIComponent(repo.identity);
    await this.request(`/projects/${projectPath}/merge_requests/${number}/discussions/${threadId}?resolved=true`, { method: 'PUT' });
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
    const res = await this.requestOrNull(`/projects/${projectPath}/merge_requests/${iid}/approvals`);
    if (!res) {
      return { approved: false, approved_by: [] };
    }
    const data = (await res.json()) as GitLabApprovals;
    return { approved: data.approved ?? false, approved_by: data.approved_by ?? [] };
  }

  /** Throws with the real reason (HTTP status or network failure) instead of swallowing it. Only `fetchApprovals` wraps this in `requestOrNull` — one MR's approval data failing to load shouldn't take down the whole list the way a credential problem on the list call itself should be visible. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.apiBaseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: {
          'PRIVATE-TOKEN': this.token,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
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
}
