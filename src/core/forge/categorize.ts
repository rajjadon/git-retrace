import type { CategorizedPullRequest, LaunchpadBucket, PullRequestSummary } from './types';

function bucketFor(pr: PullRequestSummary, myLogin: string, snoozed: boolean): LaunchpadBucket {
  if (snoozed) {
    return 'snoozed';
  }
  // A draft's readiness isn't about CI/review state at all — none of that is actionable while
  // it's still a draft, so this check comes before (and overrides) blocked/ready/needs-review.
  if (pr.isDraft) {
    return 'drafts';
  }
  if (pr.checkStatus === 'failing' || pr.reviewDecision === 'changesRequested' || pr.hasConflicts) {
    return 'blocked';
  }
  // Still in requestedReviewers means I haven't submitted a review yet — GitHub (and the other
  // hosts, normalized the same way) removes a reviewer from this list the moment they do.
  if (pr.requestedReviewers.includes(myLogin)) {
    return 'needsReview';
  }
  if (pr.reviewDecision === 'approved' && pr.checkStatus !== 'pending' && !pr.hasConflicts) {
    return 'readyToMerge';
  }
  return 'waiting';
}

/**
 * Buckets open PRs into the board's six columns. Only surfaces PRs the user actually has a stake
 * in — authored by them, or with a review requested from them — dropping the rest: a triage board
 * for "what needs my attention" shouldn't also show every other PR in a busy shared repo.
 *
 * Pure — no I/O, no host-specific knowledge. Each `ForgeClient` normalizes its host's API shape
 * into `PullRequestSummary` first; this only ever sees the common shape.
 */
export function categorizePullRequests(
  pullRequests: PullRequestSummary[],
  currentUserLogin: string,
  isSnoozed: (pr: PullRequestSummary) => boolean,
): CategorizedPullRequest[] {
  return pullRequests
    .filter((pr) => pr.authorLogin === currentUserLogin || pr.requestedReviewers.includes(currentUserLogin))
    .map((pr) => ({ pr, bucket: bucketFor(pr, currentUserLogin, isSnoozed(pr)) }));
}
