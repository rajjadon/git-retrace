import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BitbucketClient } from '../../../../src/core/forge/BitbucketClient';
import type { ForgeRepoRef } from '../../../../src/core/forge/types';

const REPO: ForgeRepoRef = { host: 'bitbucket', identity: 'acme/widgets', label: 'acme/widgets' };
const BASE = 'https://api.bitbucket.org/2.0';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 401, statusText: ok ? 'OK' : 'Unauthorized', json: async () => body } as unknown as Response;
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

test('getAuthenticatedLogin: an invalid token throws with the real HTTP status, not a generic message', async () => {
  const client = new BitbucketClient(BASE, 'bad', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.getAuthenticatedLogin(), /401 Unauthorized from api\.bitbucket\.org/);
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

test('listRecentlyClosedPullRequests: combines MERGED and DECLINED, tagging each with the right merged flag', async () => {
  const client = new BitbucketClient(BASE, 'tok', (async (url: string) => {
    if (url.includes('state=MERGED')) {
      return jsonResponse({
        values: [
          { id: 30, title: 'Shipped', links: { html: { href: 'u1' } }, author: { username: 'raj' }, created_on: 'c', updated_on: 'u' },
        ],
      });
    }
    if (url.includes('state=DECLINED')) {
      return jsonResponse({
        values: [
          { id: 31, title: 'Declined', links: { html: { href: 'u2' } }, author: { username: 'raj' }, created_on: 'c', updated_on: 'u' },
        ],
      });
    }
    throw new Error(`unmocked request: ${url}`);
  }) as unknown as typeof fetch);
  const result = await client.listRecentlyClosedPullRequests(REPO);
  assert.equal(result.length, 2);
  assert.equal(result.find((r) => r.number === 30)?.merged, true);
  assert.equal(result.find((r) => r.number === 31)?.merged, false);
});

test('closePullRequest: POSTs to the decline endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new BitbucketClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.closePullRequest(REPO, 32);
  assert.equal(capturedUrl, 'https://api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests/32/decline');
  assert.equal(capturedInit?.method, 'POST');
});
