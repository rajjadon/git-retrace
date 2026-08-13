import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveForgeRepoRef } from '../../../../src/core/forge/resolveRepoRef';
import type { ForgeHostConfig } from '../../../../src/core/forge/hostDetection';

test('resolveForgeRepoRef: a GitHub HTTPS remote resolves to owner/repo', () => {
  assert.deepEqual(resolveForgeRepoRef('https://github.com/acme/widgets.git', []), {
    host: 'github',
    identity: 'acme/widgets',
    label: 'acme/widgets',
  });
});

test('resolveForgeRepoRef: a GitHub SSH remote resolves the same way', () => {
  assert.deepEqual(resolveForgeRepoRef('git@github.com:acme/widgets.git', []), {
    host: 'github',
    identity: 'acme/widgets',
    label: 'acme/widgets',
  });
});

test('resolveForgeRepoRef: a GitLab remote with a nested group path keeps the full path', () => {
  assert.deepEqual(resolveForgeRepoRef('https://gitlab.com/acme/platform/widgets.git', []), {
    host: 'gitlab',
    identity: 'acme/platform/widgets',
    label: 'acme/platform/widgets',
  });
});

test('resolveForgeRepoRef: a Bitbucket remote resolves to workspace/repo', () => {
  assert.deepEqual(resolveForgeRepoRef('https://bitbucket.org/acme/widgets.git', []), {
    host: 'bitbucket',
    identity: 'acme/widgets',
    label: 'acme/widgets',
  });
});

test('resolveForgeRepoRef: an Azure DevOps remote resolves to organization/project/repository, not owner/repo', () => {
  assert.deepEqual(resolveForgeRepoRef('https://dev.azure.com/acme/Widgets/_git/widgets-api', []), {
    host: 'azureDevOps',
    identity: 'acme/Widgets/widgets-api',
    label: 'acme/Widgets/widgets-api',
  });
});

test('resolveForgeRepoRef: an Azure DevOps SSH remote (git@ssh.dev.azure.com:v3/org/project/repo) resolves too', () => {
  assert.deepEqual(resolveForgeRepoRef('git@ssh.dev.azure.com:v3/GoFynd/FyndOne/Boltic', []), {
    host: 'azureDevOps',
    identity: 'GoFynd/FyndOne/Boltic',
    label: 'GoFynd/FyndOne/Boltic',
  });
});

test('resolveForgeRepoRef: an unrecognized, unconfigured host returns null', () => {
  assert.equal(resolveForgeRepoRef('https://git.acme.internal/acme/widgets.git', []), null);
});

test('resolveForgeRepoRef: a custom-configured self-hosted GitLab resolves via customHosts', () => {
  const customHosts: ForgeHostConfig[] = [
    { hostname: 'git.acme.internal', flavor: 'gitlab', apiBaseUrl: 'https://git.acme.internal/api/v4' },
  ];
  assert.deepEqual(resolveForgeRepoRef('https://git.acme.internal/acme/widgets.git', customHosts), {
    host: 'gitlab',
    identity: 'acme/widgets',
    label: 'acme/widgets',
  });
});

test('resolveForgeRepoRef: an unparseable URL returns null', () => {
  assert.equal(resolveForgeRepoRef('not a url', []), null);
});
