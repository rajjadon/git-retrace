import type { ForgeRepoRef, PullRequestSummary } from './types';

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
}
