export interface AzureDevOpsRepoIdentity {
  organization: string;
  project: string;
  repository: string;
}

/**
 * Azure DevOps has no two-part owner/repo model — a repo lives under an organization *and* a
 * project, so its remote URLs don't fit `parseRemoteUrl` (which assumes everything before the
 * last path segment is one `owner`, wrong here: it would swallow the literal `_git` marker into
 * the "owner" and silently produce a wrong identity). This is a dedicated parser for the two
 * real-world forms:
 *   - HTTPS: `https://dev.azure.com/{org}/{project}/_git/{repo}`, or the legacy
 *     `https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}`
 *   - SSH: `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}` (no `_git` marker in this form)
 *
 * Pure — no I/O.
 */
export function parseAzureDevOpsRemoteUrl(url: string): AzureDevOpsRepoIdentity | null {
  const trimmed = url.trim();

  const sshMatch = /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (sshMatch) {
    const [, organization, project, repository] = sshMatch;
    if (organization && project && repository) {
      return { organization, project, repository };
    }
  }

  const httpsMatch = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)\/_git\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (!httpsMatch) {
    return null;
  }
  const [, host, pathBeforeGit, repository] = httpsMatch;
  if (!host || !pathBeforeGit || !repository) {
    return null;
  }
  // The legacy visualstudio.com form sometimes nests project under a "DefaultCollection" segment
  // that carries no identity of its own — drop it rather than misreading it as the project name.
  const segments = pathBeforeGit.split('/').filter((s) => s.length > 0 && s !== 'DefaultCollection');

  if (host === 'dev.azure.com') {
    const [organization, project] = segments;
    return organization && project ? { organization, project, repository } : null;
  }
  if (host.endsWith('.visualstudio.com')) {
    const organization = host.split('.')[0];
    const project = segments[0];
    return organization && project ? { organization, project, repository } : null;
  }
  return null;
}

/** `ForgeRepoRef.identity` encoding for Azure DevOps — "org/project/repo" round-trips through `splitAzureDevOpsIdentity` in the client. Project names containing a literal slash (rare in practice) aren't representable this way; documented limitation, not a silent corruption. */
export function buildAzureDevOpsIdentity(id: AzureDevOpsRepoIdentity): string {
  return `${id.organization}/${id.project}/${id.repository}`;
}

export function splitAzureDevOpsIdentity(identity: string): AzureDevOpsRepoIdentity | null {
  const [organization, project, repository] = identity.split('/');
  return organization && project && repository ? { organization, project, repository } : null;
}
