import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteUrl } from '../../../../src/core/git/parsers';

// Deliberately neutral fixtures. Using this project's own repo name here coupled the tests to it,
// and two renames later the inputs and the expectations had drifted apart.

test('parseRemoteUrl: https URL with .git suffix', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/acme/widgets.git'), {
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
  });
});

test('parseRemoteUrl: https URL without .git suffix', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/acme/widgets'), {
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
  });
});

test('parseRemoteUrl: scp-style SSH shorthand', () => {
  assert.deepEqual(parseRemoteUrl('git@github.com:acme/widgets.git'), {
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
  });
});

test('parseRemoteUrl: full ssh:// URL with a port', () => {
  assert.deepEqual(parseRemoteUrl('ssh://git@gitlab.example.com:2222/group/subgroup/repo.git'), {
    host: 'gitlab.example.com',
    owner: 'group/subgroup',
    repo: 'repo',
  });
});

test('parseRemoteUrl: GitLab nested subgroup over https', () => {
  assert.deepEqual(parseRemoteUrl('https://gitlab.com/group/subgroup/repo.git'), {
    host: 'gitlab.com',
    owner: 'group/subgroup',
    repo: 'repo',
  });
});

test('parseRemoteUrl: https URL with embedded credentials', () => {
  assert.deepEqual(parseRemoteUrl('https://oauth2:token123@gitlab.com/owner/repo.git'), {
    host: 'gitlab.com',
    owner: 'owner',
    repo: 'repo',
  });
});

test('parseRemoteUrl: unrecognized formats return null', () => {
  assert.equal(parseRemoteUrl('not a url'), null);
  assert.equal(parseRemoteUrl('/local/path/to/repo.git'), null);
  assert.equal(parseRemoteUrl(''), null);
});
