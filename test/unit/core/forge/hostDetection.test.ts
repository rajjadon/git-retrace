import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectForgeHost } from '../../../../src/core/forge/hostDetection';
import type { ForgeHostConfig } from '../../../../src/core/forge/hostDetection';

test('detectForgeHost: github.com needs no configuration', () => {
  assert.deepEqual(detectForgeHost('github.com', []), {
    flavor: 'github',
    apiBaseUrl: 'https://api.github.com',
    displayHost: 'github.com',
  });
});

test('detectForgeHost: gitlab.com needs no configuration', () => {
  assert.deepEqual(detectForgeHost('gitlab.com', []), {
    flavor: 'gitlab',
    apiBaseUrl: 'https://gitlab.com/api/v4',
    displayHost: 'gitlab.com',
  });
});

test('detectForgeHost: bitbucket.org needs no configuration', () => {
  assert.deepEqual(detectForgeHost('bitbucket.org', []), {
    flavor: 'bitbucket',
    apiBaseUrl: 'https://api.bitbucket.org/2.0',
    displayHost: 'bitbucket.org',
  });
});

test('detectForgeHost: dev.azure.com needs no configuration', () => {
  assert.deepEqual(detectForgeHost('dev.azure.com', []), {
    flavor: 'azureDevOps',
    apiBaseUrl: 'https://dev.azure.com',
    displayHost: 'dev.azure.com',
  });
});

test('detectForgeHost: the legacy <org>.visualstudio.com form is also Azure DevOps', () => {
  const result = detectForgeHost('acme.visualstudio.com', []);
  assert.equal(result?.flavor, 'azureDevOps');
  assert.equal(result?.apiBaseUrl, 'https://dev.azure.com');
  assert.equal(result?.displayHost, 'acme.visualstudio.com');
});

test('detectForgeHost: is case-insensitive about the hostname', () => {
  assert.equal(detectForgeHost('GitHub.COM', [])?.flavor, 'github');
});

test('detectForgeHost: an unrecognized host with no custom config returns null', () => {
  assert.equal(detectForgeHost('git.acme.internal', []), null);
});

test('detectForgeHost: a custom host is resolved from gitLore.launchpad.customHosts', () => {
  const customHosts: ForgeHostConfig[] = [
    { hostname: 'git.acme.internal', flavor: 'gitlab', apiBaseUrl: 'https://git.acme.internal/api/v4' },
  ];
  assert.deepEqual(detectForgeHost('git.acme.internal', customHosts), {
    flavor: 'gitlab',
    apiBaseUrl: 'https://git.acme.internal/api/v4',
    displayHost: 'git.acme.internal',
  });
});

test('detectForgeHost: a GitHub Enterprise / Gitea / Forgejo instance speaks the github flavor via customHosts', () => {
  const customHosts: ForgeHostConfig[] = [
    { hostname: 'github.acme.com', flavor: 'github', apiBaseUrl: 'https://github.acme.com/api/v3' },
  ];
  assert.deepEqual(detectForgeHost('github.acme.com', customHosts), {
    flavor: 'github',
    apiBaseUrl: 'https://github.acme.com/api/v3',
    displayHost: 'github.acme.com',
  });
});

test('detectForgeHost: custom host matching is also case-insensitive', () => {
  const customHosts: ForgeHostConfig[] = [
    { hostname: 'Git.Acme.Internal', flavor: 'gitlab', apiBaseUrl: 'https://git.acme.internal/api/v4' },
  ];
  assert.equal(detectForgeHost('git.acme.internal', customHosts)?.flavor, 'gitlab');
});

test('detectForgeHost: well-known hosts are matched before consulting customHosts', () => {
  // A custom entry can't override github.com's own well-known mapping.
  const customHosts: ForgeHostConfig[] = [{ hostname: 'github.com', flavor: 'gitlab', apiBaseUrl: 'https://example.com/api/v4' }];
  assert.equal(detectForgeHost('github.com', customHosts)?.flavor, 'github');
});
