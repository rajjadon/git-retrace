import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAzureDevOpsIdentity,
  parseAzureDevOpsRemoteUrl,
  splitAzureDevOpsIdentity,
} from '../../../../src/core/forge/azureDevOpsIdentity';

test('parseAzureDevOpsRemoteUrl: the modern dev.azure.com HTTPS form', () => {
  assert.deepEqual(parseAzureDevOpsRemoteUrl('https://dev.azure.com/acme/Widgets/_git/widgets-api'), {
    organization: 'acme',
    project: 'Widgets',
    repository: 'widgets-api',
  });
});

test('parseAzureDevOpsRemoteUrl: the legacy <org>.visualstudio.com HTTPS form', () => {
  assert.deepEqual(parseAzureDevOpsRemoteUrl('https://acme.visualstudio.com/Widgets/_git/widgets-api'), {
    organization: 'acme',
    project: 'Widgets',
    repository: 'widgets-api',
  });
});

test('parseAzureDevOpsRemoteUrl: the legacy form with a DefaultCollection segment', () => {
  assert.deepEqual(parseAzureDevOpsRemoteUrl('https://acme.visualstudio.com/DefaultCollection/Widgets/_git/widgets-api'), {
    organization: 'acme',
    project: 'Widgets',
    repository: 'widgets-api',
  });
});

test('parseAzureDevOpsRemoteUrl: the SSH form (no _git marker)', () => {
  assert.deepEqual(parseAzureDevOpsRemoteUrl('git@ssh.dev.azure.com:v3/acme/Widgets/widgets-api'), {
    organization: 'acme',
    project: 'Widgets',
    repository: 'widgets-api',
  });
});

test('parseAzureDevOpsRemoteUrl: strips a trailing .git', () => {
  assert.deepEqual(parseAzureDevOpsRemoteUrl('https://dev.azure.com/acme/Widgets/_git/widgets-api.git'), {
    organization: 'acme',
    project: 'Widgets',
    repository: 'widgets-api',
  });
});

test('parseAzureDevOpsRemoteUrl: a non-Azure-DevOps URL returns null rather than a wrong guess', () => {
  assert.equal(parseAzureDevOpsRemoteUrl('https://github.com/acme/widgets.git'), null);
});

test('parseAzureDevOpsRemoteUrl: a URL missing the _git marker on dev.azure.com returns null', () => {
  assert.equal(parseAzureDevOpsRemoteUrl('https://dev.azure.com/acme/Widgets/widgets-api'), null);
});

test('buildAzureDevOpsIdentity and splitAzureDevOpsIdentity round-trip', () => {
  const id = { organization: 'acme', project: 'Widgets', repository: 'widgets-api' };
  assert.deepEqual(splitAzureDevOpsIdentity(buildAzureDevOpsIdentity(id)), id);
});

test('splitAzureDevOpsIdentity: a malformed identity (missing parts) returns null', () => {
  assert.equal(splitAzureDevOpsIdentity('acme/Widgets'), null);
});
