import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitLabClient } from '../../../../src/core/forge/GitLabClient';
import type { ForgeRepoRef } from '../../../../src/core/forge/types';

const REPO: ForgeRepoRef = { host: 'gitlab', identity: 'acme/widgets', label: 'acme/widgets' };
const BASE = 'https://gitlab.com/api/v4';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    for (const [suffix, body] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        return jsonResponse(body);
      }
    }
    throw new Error(`unmocked request: ${url}`);
  }) as typeof fetch;
}

test('getAuthenticatedLogin: returns the username from GET /user', async () => {
  const client = new GitLabClient(BASE, 'tok', fakeFetch({ '/user': { username: 'raj' } }));
  assert.equal(await client.getAuthenticatedLogin(), 'raj');
});

test('getAuthenticatedLogin: an invalid token returns null, not a throw', async () => {
  const client = new GitLabClient(BASE, 'bad', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  assert.equal(await client.getAuthenticatedLogin(), null);
});

test('listOpenPullRequests: URL-encodes a nested-group project path', async () => {
  const nested: ForgeRepoRef = { host: 'gitlab', identity: 'acme/platform/widgets', label: 'acme/platform/widgets' };
  let requestedUrl = '';
  const client = new GitLabClient(BASE, 'tok', (async (url: string) => {
    requestedUrl = url;
    if (url.includes('merge_requests?state=opened')) {
      return jsonResponse([]);
    }
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.listOpenPullRequests(nested);
  assert.ok(requestedUrl.includes(encodeURIComponent('acme/platform/widgets')));
});

test('listOpenPullRequests: normalizes a plain open MR with no reviewers, pipeline, or conflicts', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests?state=opened&per_page=100': [
        {
          iid: 1,
          title: 'Add feature',
          web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/1',
          author: { username: 'raj' },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ],
      '/approvals': { approved: false, approved_by: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, 'Add feature');
  assert.equal(result[0]?.checkStatus, 'none');
  assert.equal(result[0]?.reviewDecision, 'none');
  assert.equal(result[0]?.hasConflicts, false);
});

test('listOpenPullRequests: draft is read from either draft or the legacy work_in_progress field', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests?state=opened&per_page=100': [
        { iid: 1, title: 'WIP', web_url: 'u', author: { username: 'raj' }, created_at: 'c', updated_at: 'u', work_in_progress: true },
      ],
      '/approvals': { approved: false, approved_by: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.isDraft, true);
});

test('listOpenPullRequests: has_conflicts maps straight through, no extra request needed', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests?state=opened&per_page=100': [
        { iid: 1, title: 'PR', web_url: 'u', author: { username: 'raj' }, created_at: 'c', updated_at: 'u', has_conflicts: true },
      ],
      '/approvals': { approved: false, approved_by: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.hasConflicts, true);
});

test('listOpenPullRequests: blocking_discussions_resolved === false maps to changesRequested', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests?state=opened&per_page=100': [
        {
          iid: 1,
          title: 'PR',
          web_url: 'u',
          author: { username: 'raj' },
          created_at: 'c',
          updated_at: 'u',
          blocking_discussions_resolved: false,
        },
      ],
      '/approvals': { approved: true, approved_by: [{ user: { username: 'amy' } }] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  // Even though approved, an unresolved required discussion is the more actionable/blocking signal.
  assert.equal(result[0]?.reviewDecision, 'changesRequested');
});

test('listOpenPullRequests: a reviewer who has personally approved is removed from requestedReviewers, others remain', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests?state=opened&per_page=100': [
        {
          iid: 1,
          title: 'PR',
          web_url: 'u',
          author: { username: 'raj' },
          created_at: 'c',
          updated_at: 'u',
          reviewers: [{ username: 'amy' }, { username: 'bob' }],
        },
      ],
      '/approvals': { approved: false, approved_by: [{ user: { username: 'amy' } }] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.deepEqual(result[0]?.requestedReviewers, ['bob']);
  assert.equal(result[0]?.reviewDecision, 'reviewRequired');
});

test('listOpenPullRequests: overall approved with everyone having personally approved -> "approved"', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests?state=opened&per_page=100': [
        { iid: 1, title: 'PR', web_url: 'u', author: { username: 'raj' }, created_at: 'c', updated_at: 'u', reviewers: [{ username: 'amy' }] },
      ],
      '/approvals': { approved: true, approved_by: [{ user: { username: 'amy' } }] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.deepEqual(result[0]?.requestedReviewers, []);
  assert.equal(result[0]?.reviewDecision, 'approved');
});

test('listOpenPullRequests: pipeline status maps to checkStatus (success/failed/running)', async () => {
  async function pipelineCheck(status: string, expected: string): Promise<void> {
    const client = new GitLabClient(
      BASE,
      'tok',
      fakeFetch({
        'merge_requests?state=opened&per_page=100': [
          { iid: 1, title: 'PR', web_url: 'u', author: { username: 'raj' }, created_at: 'c', updated_at: 'u', head_pipeline: { status } },
        ],
        '/approvals': { approved: false, approved_by: [] },
      }),
    );
    const result = await client.listOpenPullRequests(REPO);
    assert.equal(result[0]?.checkStatus, expected, `pipeline status "${status}"`);
  }
  await pipelineCheck('success', 'passing');
  await pipelineCheck('skipped', 'passing');
  await pipelineCheck('failed', 'failing');
  await pipelineCheck('canceled', 'failing');
  await pipelineCheck('running', 'pending');
});

test('listOpenPullRequests: no pipeline at all -> checkStatus "none"', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests?state=opened&per_page=100': [
        { iid: 1, title: 'PR', web_url: 'u', author: { username: 'raj' }, created_at: 'c', updated_at: 'u', head_pipeline: null },
      ],
      '/approvals': { approved: false, approved_by: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.checkStatus, 'none');
});

test('listOpenPullRequests: a failed list request returns an empty array, not a throw', async () => {
  const client = new GitLabClient(BASE, 'tok', (async () => jsonResponse([], false)) as unknown as typeof fetch);
  assert.deepEqual(await client.listOpenPullRequests(REPO), []);
});
