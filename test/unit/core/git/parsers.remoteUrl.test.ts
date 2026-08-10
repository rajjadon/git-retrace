import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteUrl } from '../../../../src/core/git/parsers';

test('parseRemoteUrl: https URL with .git suffix', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/rajjadon/gitSense.git'), {
    host: 'github.com',
    owner: 'rajjadon',
    repo: 'gitSense',
  });
});

test('parseRemoteUrl: https URL without .git suffix', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/rajjadon/gitSense'), {
    host: 'github.com',
    owner: 'rajjadon',
    repo: 'gitSense',
  });
});

test('parseRemoteUrl: scp-style SSH shorthand', () => {
  assert.deepEqual(parseRemoteUrl('git@github.com:rajjadon/gitSense.git'), {
    host: 'github.com',
    owner: 'rajjadon',
    repo: 'gitSense',
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
