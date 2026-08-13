import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForgeClient } from '../../../../src/core/forge/buildForgeClient';
import { GitHubClient } from '../../../../src/core/forge/GitHubClient';
import { GitLabClient } from '../../../../src/core/forge/GitLabClient';
import { BitbucketClient } from '../../../../src/core/forge/BitbucketClient';
import { AzureDevOpsClient } from '../../../../src/core/forge/AzureDevOpsClient';

test('buildForgeClient: github flavor builds a GitHubClient', () => {
  assert.ok(buildForgeClient('github', 'https://api.github.com', 'tok') instanceof GitHubClient);
});

test('buildForgeClient: gitlab flavor builds a GitLabClient', () => {
  assert.ok(buildForgeClient('gitlab', 'https://gitlab.com/api/v4', 'tok') instanceof GitLabClient);
});

test('buildForgeClient: bitbucket flavor builds a BitbucketClient', () => {
  assert.ok(buildForgeClient('bitbucket', 'https://api.bitbucket.org/2.0', 'tok') instanceof BitbucketClient);
});

test('buildForgeClient: azureDevOps flavor builds an AzureDevOpsClient', () => {
  assert.ok(buildForgeClient('azureDevOps', 'ignored', 'tok') instanceof AzureDevOpsClient);
});
