import { parseRemoteUrl } from '../git/parsers';
import { buildAzureDevOpsIdentity, parseAzureDevOpsRemoteUrl } from './azureDevOpsIdentity';
import { detectForgeHost, type ForgeHostConfig } from './hostDetection';
import type { ForgeRepoRef } from './types';

/**
 * Resolves a raw git remote URL to a `ForgeRepoRef` — which host to talk to and how to identify
 * the repo on it. Azure DevOps needs its own identity parse (organization/project/repository,
 * not the owner/repo two-tuple `parseRemoteUrl` assumes); every other flavor reuses `parseRemoteUrl`
 * directly, since `owner/repo` is already exactly what GitHub/GitLab/Bitbucket's APIs expect.
 *
 * Returns null when the host isn't recognized (and isn't in `customHosts` either) or the URL
 * doesn't parse — the caller skips that repo rather than guessing.
 *
 * Pure — no I/O, no vscode import.
 */
export function resolveForgeRepoRef(remoteUrl: string, customHosts: ForgeHostConfig[]): ForgeRepoRef | null {
  const remoteInfo = parseRemoteUrl(remoteUrl);
  if (!remoteInfo) {
    return null;
  }
  const detected = detectForgeHost(remoteInfo.host, customHosts);
  if (!detected) {
    return null;
  }

  if (detected.flavor === 'azureDevOps') {
    const id = parseAzureDevOpsRemoteUrl(remoteUrl);
    if (!id) {
      return null;
    }
    return { host: 'azureDevOps', identity: buildAzureDevOpsIdentity(id), label: `${id.organization}/${id.project}/${id.repository}` };
  }

  const label = `${remoteInfo.owner}/${remoteInfo.repo}`;
  return { host: detected.flavor, identity: label, label };
}
