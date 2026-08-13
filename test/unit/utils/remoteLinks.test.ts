import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommitUrl, buildCreatePrUrl, buildRepoUrl, remoteHostLabel } from '../../../src/utils/remoteLinks';
import type { RemoteInfo } from '../../../src/core/git/types';

const SHA = '5a93a8d3e93fcc0a1f409e89d3aaca4346ced8ec';

function remote(host: string, owner = 'acme', repo = 'widgets'): RemoteInfo {
  return { host, owner, repo };
}

test('remoteHostLabel: names the well-known hosts', () => {
  assert.equal(remoteHostLabel(remote('github.com')), 'GitHub');
  assert.equal(remoteHostLabel(remote('GitHub.com')), 'GitHub');
  assert.equal(remoteHostLabel(remote('gitlab.com')), 'GitLab');
  assert.equal(remoteHostLabel(remote('gitlab.acme.internal')), 'GitLab');
  assert.equal(remoteHostLabel(remote('bitbucket.org')), 'Bitbucket');
});

test('remoteHostLabel: falls back to the hostname, which the user still recognizes', () => {
  assert.equal(remoteHostLabel(remote('git.acme.dev')), 'git.acme.dev');
});

test('buildCommitUrl: GitHub uses /commit/<sha>', () => {
  assert.equal(buildCommitUrl(remote('github.com'), SHA), `https://github.com/acme/widgets/commit/${SHA}`);
});

test('buildCommitUrl: GitLab nests the project path under /-/', () => {
  assert.equal(buildCommitUrl(remote('gitlab.com'), SHA), `https://gitlab.com/acme/widgets/-/commit/${SHA}`);
});

test('buildCommitUrl: GitLab keeps nested group paths intact', () => {
  const nested = remote('gitlab.com', 'acme/platform/team', 'widgets');
  assert.equal(buildCommitUrl(nested, SHA), `https://gitlab.com/acme/platform/team/widgets/-/commit/${SHA}`);
});

test('buildCommitUrl: Bitbucket spells the segment "commits"', () => {
  assert.equal(buildCommitUrl(remote('bitbucket.org'), SHA), `https://bitbucket.org/acme/widgets/commits/${SHA}`);
});

test('buildCommitUrl: an unknown host gets no URL rather than a guessed one', () => {
  // Better to hide the action than to offer a button that reliably 404s.
  assert.equal(buildCommitUrl(remote('git.acme.dev'), SHA), null);
});

test('buildCommitUrl: a GitHub Enterprise host is not sniffable, so it gets no URL', () => {
  // GHE can live on any hostname — `github.acme.com` is no more detectable than `git.acme.dev`.
  // Guessing GitHub's URL shape for it would produce a broken link on every non-GHE lookalike.
  assert.equal(remoteHostLabel(remote('github.acme.com')), 'github.acme.com');
  assert.equal(buildCommitUrl(remote('github.acme.com'), SHA), null);
});

test('buildRepoUrl: builds the repo home page for a known host', () => {
  assert.equal(buildRepoUrl(remote('github.com')), 'https://github.com/acme/widgets');
});

test('buildRepoUrl: works for an unrecognized self-hosted host too — no host gating needed for a repo home page', () => {
  assert.equal(buildRepoUrl(remote('git.acme.dev')), 'https://git.acme.dev/acme/widgets');
});

test('buildRepoUrl: keeps nested group paths intact', () => {
  assert.equal(
    buildRepoUrl(remote('gitlab.com', 'acme/platform/team', 'widgets')),
    'https://gitlab.com/acme/platform/team/widgets',
  );
});

test('buildCreatePrUrl: GitHub uses /compare/base...compare?expand=1', () => {
  assert.equal(
    buildCreatePrUrl(remote('github.com'), 'main', 'feature-x'),
    'https://github.com/acme/widgets/compare/main...feature-x?expand=1',
  );
});

test('buildCreatePrUrl: GitLab uses /-/merge_requests/new with source/target query params', () => {
  assert.equal(
    buildCreatePrUrl(remote('gitlab.com'), 'main', 'feature-x'),
    'https://gitlab.com/acme/widgets/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature-x&merge_request%5Btarget_branch%5D=main',
  );
});

test('buildCreatePrUrl: Bitbucket uses /pull-requests/new with source/dest query params', () => {
  assert.equal(
    buildCreatePrUrl(remote('bitbucket.org'), 'main', 'feature-x'),
    'https://bitbucket.org/acme/widgets/pull-requests/new?source=feature-x&dest=acme%2Fwidgets%3A%3Amain',
  );
});

test('buildCreatePrUrl: an unknown host gets no URL rather than a guessed one', () => {
  assert.equal(buildCreatePrUrl(remote('git.acme.dev'), 'main', 'feature-x'), null);
});

test('buildCreatePrUrl: branch names with special characters are percent-encoded', () => {
  const url = buildCreatePrUrl(remote('github.com'), 'main', 'feature/foo bar');
  assert.ok(url);
  assert.ok(url.includes(encodeURIComponent('feature/foo bar')));
});
