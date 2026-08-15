import type {
  ConversationThread,
  CreatePullRequestOptions,
  ForgeRepoRef,
  MergeOptions,
  PullRequestDiff,
  PullRequestSummary,
  ReviewSubmission,
} from './types';

/**
 * One host's PR API, normalized to GitLore's common shape. Each implementation (GitHub, GitLab,
 * Bitbucket, Azure DevOps) is the only place that touches that host's specific REST API — same
 * "one boundary" discipline as `GitService` for git itself. Takes its credential (an access
 * token/PAT) at construction; resolving *that* token (VS Code's built-in GitHub auth session, or
 * a Personal Access Token from SecretStorage for everything else) is the caller's job, not this
 * interface's.
 */
export interface ForgeClient {
  /**
   * The signed-in user's login/username on this host. Throws with a specific reason (HTTP status,
   * network failure) if the credential is invalid/expired or the host can't be reached — the one
   * call in this interface where the caller needs to know *why*, not just that it failed, so it
   * can show something more actionable than a one-size-fits-all "couldn't authenticate".
   */
  getAuthenticatedLogin(): Promise<string | null>;
  /** Every open PR/MR in this repo, enriched with review/check/conflict state, normalized to `PullRequestSummary`. */
  listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]>;
  /**
   * A bounded, most-recently-updated slice of this repo's merged and closed-without-merging
   * PRs/MRs — no review/check enrichment, since none of that applies to a PR that's already done.
   * `closedAt`/`merged` are always set on every item returned here.
   */
  listRecentlyClosedPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]>;
  /** Closes an open PR/MR without merging it. Throws with the real reason (HTTP status, network failure, or a permissions rejection) on failure — the caller surfaces it as an error toast. */
  closePullRequest(repo: ForgeRepoRef, number: number): Promise<void>;
  /**
   * Reopens a PR/MR that was closed without merging (never a merged one — no host we support lets
   * a merge be undone through this endpoint). Throws with the real reason on failure, same
   * contract as `closePullRequest`. Bitbucket Cloud has no way to reopen a declined PR at all —
   * not through its API, not even through its own web UI — so that call throws a clear
   * platform-gap message instead of pretending it's possible.
   */
  reopenPullRequest(repo: ForgeRepoRef, number: number): Promise<void>;
  /** This PR's changed files and diff text, for the PR Details panel. See `PullRequestDiff` for what an empty `diff` means. */
  getPullRequestDiff(repo: ForgeRepoRef, number: number): Promise<PullRequestDiff>;
  /**
   * Submits an approve/request-changes review decision. Throws with the real reason (HTTP status,
   * network failure, a permissions rejection) on failure — same contract as `closePullRequest`.
   * GitLab has no formal "request changes" review state (see `GitLabClient.submitReview`), so
   * `'requestChanges'` there throws a clear, platform-specific message instead of faking a state
   * that doesn't exist — never a silent no-op.
   */
  submitReview(repo: ForgeRepoRef, number: number, decision: ReviewSubmission): Promise<void>;
  /** Posts a top-level comment on the PR (not a reply to any specific review thread). Throws with the real reason on failure — same contract as `closePullRequest`. */
  addComment(repo: ForgeRepoRef, number: number, body: string): Promise<void>;
  /** Every review conversation on this PR, resolved or not — see `ConversationThread`. */
  listConversationThreads(repo: ForgeRepoRef, number: number): Promise<ConversationThread[]>;
  /**
   * Marks a conversation thread resolved. Throws with the real reason on failure — same contract
   * as `closePullRequest`. GitHub has no REST endpoint for this at all, only a GraphQL mutation
   * (see `GitHubClient`'s dedicated `graphql()` request path, alongside its normal REST `request()`).
   */
  resolveConversationThread(repo: ForgeRepoRef, number: number, threadId: string): Promise<void>;
  /**
   * Merges an open PR/MR with the given strategy, optionally deleting its source branch
   * afterward. Throws with the real reason (HTTP status, network failure, a permissions
   * rejection, merge conflicts, or a required check that hasn't passed) on failure — same contract
   * as `closePullRequest`; there's no pre-flight mergeability check, the host's own rejection is
   * the truth. `strategy: 'rebase'` throws a platform-gap error on GitLab and Bitbucket — see
   * `MERGE_STRATEGIES_BY_HOST`, which the caller uses to keep that option off the merge QuickPick
   * for those hosts in the first place.
   */
  mergePullRequest(repo: ForgeRepoRef, number: number, options: MergeOptions): Promise<void>;
  /**
   * Creates a new PR/MR from `compare` into `base`, returning a thin `PullRequestSummary` built
   * straight from the creation response — no follow-up enrichment call, since a PR that's seconds
   * old has no reviews/checks yet to enrich. Throws with the real reason (HTTP status, network
   * failure, a validation rejection like "no commits between these branches") on failure — same
   * contract as `closePullRequest`. `options.draft: true` throws a platform-gap error on Bitbucket,
   * which has no draft-PR concept at all — see `DRAFT_SUPPORTED_HOSTS`, which the caller uses to
   * keep that choice off the create-PR flow for that host in the first place. GitLab has no
   * boolean draft field either, but represents it by prefixing the title instead of rejecting it —
   * see `GitLabClient.createPullRequest`.
   */
  createPullRequest(repo: ForgeRepoRef, options: CreatePullRequestOptions): Promise<PullRequestSummary>;
}
