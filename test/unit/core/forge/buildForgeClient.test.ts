import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForgeClient } from '../../../../src/core/forge/buildForgeClient';
import { GitHubClient } from '../../../../src/core/forge/GitHubClient';
import { GitLabClient } from '../../../../src/core/forge/GitLabClient';
import { BitbucketClient } from '../../../../src/core/forge/BitbucketClient';
import { AzureDevOpsClient } from '../../../../src/core/forge/AzureDevOpsClient';

test('buildForgeClient: github flavor builds a GitHubClient', () => {
  assert.ok(buildForgeClient('github', 'https://api.github.com', 'owner/repo', 'tok') instanceof GitHubClient);
});

test('buildForgeClient: gitlab flavor builds a GitLabClient', () => {
  assert.ok(buildForgeClient('gitlab', 'https://gitlab.com/api/v4', 'owner/repo', 'tok') instanceof GitLabClient);
});

test('buildForgeClient: bitbucket flavor builds a BitbucketClient', () => {
  assert.ok(buildForgeClient('bitbucket', 'https://api.bitbucket.org/2.0', 'owner/repo', 'tok') instanceof BitbucketClient);
});

test('buildForgeClient: azureDevOps flavor builds an AzureDevOpsClient', () => {
  assert.ok(buildForgeClient('azureDevOps', 'ignored', 'acme/Widgets/widgets-api', 'tok') instanceof AzureDevOpsClient);
});

test('buildForgeClient: azureDevOps credentialScheme "oauth" reaches the client as a Bearer token', async () => {
  let capturedAuth: string | undefined;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    capturedAuth = (init?.headers as Record<string, string>).Authorization;
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  const client = buildForgeClient('azureDevOps', 'ignored', 'acme/Widgets/widgets-api', 'aad-token', 'oauth', fetchImpl);
  await client.getAuthenticatedLogin();
  assert.equal(capturedAuth, 'Bearer aad-token');
});
