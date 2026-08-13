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
  /** The signed-in user's login/username on this host, or null if the credential is invalid/expired. */
  getAuthenticatedLogin(): Promise<string | null>;
  /** Every open PR/MR in this repo, enriched with review/check/conflict state, normalized to `PullRequestSummary`. */
  listOpenPullRequests(repo: ForgeRepoRef): Promise<PullRequestSummary[]>;
}
