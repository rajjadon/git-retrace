import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BitbucketClient } from '../../../../src/core/forge/BitbucketClient';
import type { ForgeRepoRef } from '../../../../src/core/forge/types';

const REPO: ForgeRepoRef = { host: 'bitbucket', identity: 'acme/widgets', label: 'acme/widgets' };
const BASE = 'https://api.bitbucket.org/2.0';

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

test('getAuthenticatedLogin: returns username from GET /user', async () => {
  const client = new BitbucketClient(BASE, 'tok', fakeFetch({ '/user': { username: 'raj' } }));
  assert.equal(await client.getAuthenticatedLogin(), 'raj');
});

test('getAuthenticatedLogin: falls back to nickname when username is absent', async () => {
  const client = new BitbucketClient(BASE, 'tok', fakeFetch({ '/user': { nickname: 'raj-nick' } }));
  assert.equal(await client.getAuthenticatedLogin(), 'raj-nick');
});

test('getAuthenticatedLogin: an invalid token returns null, not a throw', async () => {
  const client = new BitbucketClient(BASE, 'bad', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  assert.equal(await client.getAuthenticatedLogin(), null);
});

test('listOpenPullRequests: normalizes a plain open PR with no reviewers or build statuses', async () => {
  const client = new BitbucketClient(
    BASE,
    'tok',
    fakeFetch({
      'pullrequests?state=OPEN': {
        values: [
          {
            id: 1,
            title: 'Add feature',
            links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/1' } },
            author: { username: 'raj' },
            created_on: '2024-01-01T00:00:00Z',
            updated_on: '2024-01-02T00:00:00Z',
            source: { commit: { hash: 'abc123' } },
          },
        ],
      },
      '/statuses': { values: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, 'Add feature');
  assert.equal(result[0]?.checkStatus, 'none');
  assert.equal(result[0]?.reviewDecision, 'none');
  assert.equal(result[0]?.hasConflicts, false);
});

test('listOpenPullRequests: a reviewer with state changes_requested -> reviewDecision "changesRequested"', async () => {
  const client = new BitbucketClient(
    BASE,
    'tok',
    fakeFetch({
      'pullrequests?state=OPEN': {
        values: [
          {
            id: 2,
            title: 'PR',
            links: { html: { href: 'u' } },
            author: { username: 'raj' },
            created_on: 'c',
            updated_on: 'u',
            participants: [{ user: { username: 'amy' }, role: 'REVIEWER', approved: false, state: 'changes_requested' }],
            source: { commit: { hash: 'sha2' } },
          },
        ],
      },
      '/statuses': { values: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, 'changesRequested');
  assert.deepEqual(result[0]?.requestedReviewers, ['amy']);
});

test('listOpenPullRequests: an unapproved reviewer with no explicit state -> "reviewRequired"', async () => {
  const client = new BitbucketClient(
    BASE,
    'tok',
    fakeFetch({
      'pullrequests?state=OPEN': {
        values: [
          {
            id: 3,
            title: 'PR',
            links: { html: { href: 'u' } },
            author: { username: 'raj' },
            created_on: 'c',
            updated_on: 'u',
            participants: [{ user: { username: 'amy' }, role: 'REVIEWER', approved: false, state: null }],
            source: { commit: { hash: 'sha3' } },
          },
        ],
      },
      '/statuses': { values: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, 'reviewRequired');
  assert.deepEqual(result[0]?.requestedReviewers, ['amy']);
});

test('listOpenPullRequests: every reviewer approved -> "approved", nobody left in requestedReviewers', async () => {
  const client = new BitbucketClient(
    BASE,
    'tok',
    fakeFetch({
      'pullrequests?state=OPEN': {
        values: [
          {
            id: 4,
            title: 'PR',
            links: { html: { href: 'u' } },
            author: { username: 'raj' },
            created_on: 'c',
            updated_on: 'u',
            participants: [{ user: { username: 'amy' }, role: 'REVIEWER', approved: true, state: 'approved' }],
            source: { commit: { hash: 'sha4' } },
          },
        ],
      },
      '/statuses': { values: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, 'approved');
  assert.deepEqual(result[0]?.requestedReviewers, []);
});

test('listOpenPullRequests: a PARTICIPANT (not a REVIEWER) never counts toward review decision', async () => {
  const client = new BitbucketClient(
    BASE,
    'tok',
    fakeFetch({
      'pullrequests?state=OPEN': {
        values: [
          {
            id: 5,
            title: 'PR',
            links: { html: { href: 'u' } },
            author: { username: 'raj' },
            created_on: 'c',
            updated_on: 'u',
            participants: [{ user: { username: 'bystander' }, role: 'PARTICIPANT', approved: false, state: null }],
            source: { commit: { hash: 'sha5' } },
          },
        ],
      },
      '/statuses': { values: [] },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, 'none');
  assert.deepEqual(result[0]?.requestedReviewers, []);
});

test('listOpenPullRequests: build status maps to checkStatus (SUCCESSFUL/FAILED/INPROGRESS)', async () => {
  async function statusCheck(state: string, expected: string): Promise<void> {
    const client = new BitbucketClient(
      BASE,
      'tok',
      fakeFetch({
        'pullrequests?state=OPEN': {
          values: [
            { id: 6, title: 'PR', links: { html: { href: 'u' } }, author: { username: 'raj' }, created_on: 'c', updated_on: 'u', source: { commit: { hash: 'sha6' } } },
          ],
        },
        '/statuses': { values: [{ state }] },
      }),
    );
    const result = await client.listOpenPullRequests(REPO);
    assert.equal(result[0]?.checkStatus, expected, `build state "${state}"`);
  }
  await statusCheck('SUCCESSFUL', 'passing');
  await statusCheck('FAILED', 'failing');
  await statusCheck('STOPPED', 'failing');
  await statusCheck('INPROGRESS', 'pending');
});

test('listOpenPullRequests: a failed list request returns an empty array, not a throw', async () => {
  const client = new BitbucketClient(BASE, 'tok', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  assert.deepEqual(await client.listOpenPullRequests(REPO), []);
});
