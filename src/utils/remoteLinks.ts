import type { RemoteInfo } from '../core/git/types';

/**
 * The hosting service's display name, for labelling the action that leaves the editor. Buttons
 * name the place the user is going ("Open on GitHub"), not the mechanism — and an unrecognized
 * self-hosted remote falls back to its own hostname, which is still something the user recognizes.
 */
export function remoteHostLabel(remote: RemoteInfo): string {
  const host = remote.host.toLowerCase();
  // Exact match only. A GitHub Enterprise install can live on any hostname, so there is nothing
  // reliable to sniff — those fall through to the hostname label and get no commit URL.
  if (host === 'github.com') {
    return 'GitHub';
  }
  if (host.includes('gitlab')) {
    return 'GitLab';
  }
  if (host.includes('bitbucket')) {
    return 'Bitbucket';
  }
  return remote.host;
}

/**
 * Web URL for a single commit. GitLab nests project paths under `/-/` and Bitbucket spells the
 * segment `commits`; GitHub (and GitHub Enterprise) use `/commit/<sha>`.
 *
 * Returns null for any other host. A self-hosted Gitea, Forgejo, cgit or Azure DevOps each has a
 * different convention, and offering a button that lands on a 404 is worse than not offering one —
 * callers hide the action when this is null.
 */
export function buildCommitUrl(remote: RemoteInfo, sha: string): string | null {
  const path = `${remote.owner}/${remote.repo}`;
  switch (remoteHostLabel(remote)) {
    case 'GitHub':
      return `https://${remote.host}/${path}/commit/${sha}`;
    case 'GitLab':
      return `https://${remote.host}/${path}/-/commit/${sha}`;
    case 'Bitbucket':
      return `https://${remote.host}/${path}/commits/${sha}`;
    default:
      return null;
  }
}
