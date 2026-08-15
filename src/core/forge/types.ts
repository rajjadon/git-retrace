import type { FileChange } from '../git/types';

/** Which hosting service a PR/repo belongs to — Launchpad isn't GitHub-only, unlike everything else in GitLore that only ever needs "is this host recognized" (see `utils/remoteLinks.ts`). */
export type ForgeHost = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';

/** Combined CI/check-run status for a PR's head commit, collapsed to one value the board can bucket on. */
export type CheckStatus = 'passing' | 'failing' | 'pending' | 'none';

/** The PR-level review aggregate — GitHub calls this `review_decision`; GitLab/Bitbucket/Azure DevOps each have their own shape, normalized to this by their own client. */
export type ReviewDecision = 'approved' | 'changesRequested' | 'reviewRequired' | 'none';

/** A review decision the user is submitting — the write-side counterpart to `ReviewDecision`, which only ever describes a PR's already-settled state. */
export type ReviewSubmission = 'approve' | 'requestChanges';

/** A merge strategy for `ForgeClient.mergePullRequest` — see `MERGE_STRATEGIES_BY_HOST` for which of these each host actually supports. */
export type MergeStrategy = 'merge' | 'squash' | 'rebase';

/** Options for `ForgeClient.mergePullRequest`. */
export interface MergeOptions {
  strategy: MergeStrategy;
  deleteSourceBranch: boolean;
}

/**
 * Which merge strategies each host's API actually supports — the merge QuickPick filters against
 * this so it never offers an option that would just error. GitLab's merge endpoint only exposes a
 * `squash` boolean, not a separate "rebase and merge" request; Bitbucket's third strategy
 * (`fast_forward`) only succeeds when the branch is already fast-forwardable, which isn't the same
 * capability as GitHub/Azure DevOps' true rebase-and-replay — neither host is credited here with a
 * `'rebase'` it can't actually do.
 */
export const MERGE_STRATEGIES_BY_HOST: Record<ForgeHost, MergeStrategy[]> = {
  github: ['merge', 'squash', 'rebase'],
  gitlab: ['merge', 'squash'],
  bitbucket: ['merge', 'squash'],
  azureDevOps: ['merge', 'squash', 'rebase'],
};

/**
 * Identifies one repo on one host. `identity` is opaque and host-specific — "owner/repo" for
 * GitHub/GitLab/Bitbucket, "organization/project/repository" for Azure DevOps (which has no
 * two-part owner/repo model) — never parsed generically, only ever round-tripped back to the
 * same host's `ForgeClient`. `label` is what the UI actually displays, so every host still reads
 * the same regardless of its identity format.
 */
export interface ForgeRepoRef {
  host: ForgeHost;
  identity: string;
  label: string;
}

/** One open pull/merge request, already flattened from whichever host's API shape into what the board needs to bucket it. */
export interface PullRequestSummary {
  repo: ForgeRepoRef;
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  /** Logins still owed a review — removed once they've submitted one, so this never includes someone who's already reviewed. */
  requestedReviewers: string[];
  checkStatus: CheckStatus;
  reviewDecision: ReviewDecision;
  hasConflicts: boolean;
  /**
   * Whether the current user has already submitted a review verdict on this PR — independent of
   * `reviewDecision` (which reflects the PR's *overall* state, not any one reviewer's) and
   * independent of `requestedReviewers` (which only tells you who's still owed one). Always
   * `false` for a PR you authored, and always `false` on a closed/merged one (neither
   * `listRecentlyClosedPullRequests` call enriches this — nothing reads it there).
   */
  reviewedByMe: boolean;
  /** Only set on a PR returned by `listRecentlyClosedPullRequests` — when it was closed (merged or not). Undefined for an open PR. */
  closedAt?: string;
  /** Only meaningful alongside `closedAt`: true if the PR was merged, false if it was closed without merging. */
  merged?: boolean;
}

/**
 * A PR's changed files plus one combined unified-diff string covering all of them — the same
 * shape `src/views/diffRender.ts`'s `renderFileSections` already renders for local commits, reused
 * here as-is. `diff` is `''` when a host's API has no way to produce diff text without diffing raw
 * file content client-side (Azure DevOps — see `AzureDevOpsClient.getPullRequestDiff`); `files`
 * still carries real paths/change-type in that case, just with `insertions`/`deletions` at `0`
 * (unknown, not "no changes") and `binary: false` — a documented gap, not a silent guess.
 */
export interface PullRequestDiff {
  files: FileChange[];
  diff: string;
}

/**
 * One review conversation on a PR — GitHub's "review thread", GitLab's "discussion", Bitbucket's
 * top-level comment (its resolution model has no separate thread object), Azure DevOps' "comment
 * thread", all normalized to this shape. `id` is opaque and host-specific, only ever round-tripped
 * back to `resolveConversationThread` on the same host's client. `body` is the thread's first/only
 * comment — enough to identify which conversation this is without fetching every reply.
 */
export interface ConversationThread {
  id: string;
  body: string;
  authorLogin: string;
  resolved: boolean;
  /** The file/line this conversation is anchored to, when it's a code comment rather than a general PR-level one — every host we support already returns this alongside the thread data `listConversationThreads` fetches, it just wasn't being read. `line` is absent for a thread that isn't attached to any specific line. */
  file?: string;
  line?: number;
}

export const LAUNCHPAD_BUCKETS = [
  'needsReview',
  'reviewed',
  'readyToMerge',
  'waiting',
  'blocked',
  'drafts',
  'snoozed',
  'merged',
  'closed',
] as const;

export type LaunchpadBucket = (typeof LAUNCHPAD_BUCKETS)[number];

export interface CategorizedPullRequest {
  pr: PullRequestSummary;
  bucket: LaunchpadBucket;
}

/** Stable, globally-unique identity for a PR across hosts and repos — a PR `number` alone repeats constantly (every repo has a #1). Used both to key the snooze store and as the webview's per-card key. */
export function pullRequestKey(pr: PullRequestSummary): string {
  return `${pr.repo.host}:${pr.repo.identity}#${pr.number}`;
}
