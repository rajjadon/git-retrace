import { AzureDevOpsClient, type AzureDevOpsCredentialScheme } from './AzureDevOpsClient';
import { BitbucketClient } from './BitbucketClient';
import type { ForgeClient } from './ForgeClient';
import { GitHubClient } from './GitHubClient';
import { GitLabClient } from './GitLabClient';
import type { ForgeHost } from './types';

/**
 * Constructs the right `ForgeClient` for a detected flavor. `apiBaseUrl` is ignored for Azure
 * DevOps — that client always talks to `dev.azure.com` (and the separate `vssps` profile host),
 * since it has no per-org API base URL the way the other three hosts do. `identity` (the repo's
 * `organization/project/repository`) is likewise only used by Azure DevOps, to route its identity
 * check through the right org's `vssps.dev.azure.com` endpoint. `credentialScheme` is Azure
 * DevOps-only too — see `AzureDevOpsClient` for why `dev.azure.com` needs both a PAT and an OAuth
 * path; the other three hosts only ever use one credential shape, so this is ignored for them.
 */
export function buildForgeClient(
  flavor: ForgeHost,
  apiBaseUrl: string,
  identity: string,
  token: string,
  credentialScheme: AzureDevOpsCredentialScheme = 'pat',
  fetchImpl: typeof fetch = fetch,
): ForgeClient {
  switch (flavor) {
    case 'github':
      return new GitHubClient(apiBaseUrl, token, fetchImpl);
    case 'gitlab':
      return new GitLabClient(apiBaseUrl, token, fetchImpl);
    case 'bitbucket':
      return new BitbucketClient(apiBaseUrl, token, fetchImpl);
    case 'azureDevOps':
      return new AzureDevOpsClient(identity, token, credentialScheme, fetchImpl);
  }
}
