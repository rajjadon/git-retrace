import type { BranchInfo } from '../core/git/types';

export interface ComparisonRefs {
  base: string;
  compare: string;
}

/**
 * Opening refs for a fresh comparison: the checked-out branch as `compare`, and its remote-tracking
 * counterpart as `base` when there is one — that's the comparison a developer wants nine times out
 * of ten ("what have I got that the remote doesn't?"). Falls back to any other branch as the base.
 *
 * Pure — no I/O. Returns null when there's nothing meaningful to compare (fewer than two refs, or
 * no branches at all).
 */
export function pickDefaultRefs(branches: BranchInfo[], currentBranch: string | null): ComparisonRefs | null {
  const compare = currentBranch ?? branches.find((b) => b.isCurrent)?.name ?? branches[0]?.name;
  if (!compare) {
    return null;
  }
  const tracking = branches.find((b) => b.isRemote && b.name.endsWith(`/${compare}`));
  // Without an upstream, prefer another *local* branch over an arbitrary remote one — a remote ref
  // that isn't this branch's upstream is a worse default than any local branch the user works in.
  const base =
    tracking?.name ??
    branches.find((b) => !b.isRemote && b.name !== compare)?.name ??
    branches.find((b) => b.name !== compare)?.name;
  return base ? { base, compare } : null;
}
