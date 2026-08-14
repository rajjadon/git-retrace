import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitLabClient } from '../../../../src/core/forge/GitLabClient';
import type { ForgeRepoRef } from '../../../../src/core/forge/types';

const REPO: ForgeRepoRef = { host: 'gitlab', identity: 'acme/widgets', label: 'acme/widgets' };
const BASE = 'https://gitlab.com/api/v4';

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

test('getAuthenticatedLogin: returns the username from GET /user', async () => {
  const client = new GitLabClient(BASE, 'tok', fakeFetch({ '/user': { username: 'raj' } }));
  assert.equal(await client.getAuthenticatedLogin(), 'raj');
});

test('getAuthenticatedLogin: an invalid token throws with the real HTTP status, not a generic message', async () => {
  const client = new GitLabClient(BASE, 'bad', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.getAuthenticatedLogin(), /401 Unauthorized from gitlab\.com/);
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

test('listOpenPullRequests: a failed list request throws with the real status, not a silent empty array', async () => {
  const client = new GitLabClient(BASE, 'tok', (async () => jsonResponse([], false)) as unknown as typeof fetch);
  await assert.rejects(() => client.listOpenPullRequests(REPO), /401 Unauthorized from gitlab\.com/);
});

test('listRecentlyClosedPullRequests: combines merged and closed lists, tagging each with the right merged flag', async () => {
  const client = new GitLabClient(BASE, 'tok', (async (url: string) => {
    if (url.includes('state=merged')) {
      return jsonResponse([
        { iid: 20, title: 'Shipped', web_url: 'u1', author: { username: 'raj' }, created_at: 'c', updated_at: '2024-01-05T00:00:00Z' },
      ]);
    }
    if (url.includes('state=closed')) {
      return jsonResponse([
        { iid: 21, title: 'Abandoned', web_url: 'u2', author: { username: 'raj' }, created_at: 'c', updated_at: '2024-01-06T00:00:00Z' },
      ]);
    }
    throw new Error(`unmocked request: ${url}`);
  }) as unknown as typeof fetch);
  const result = await client.listRecentlyClosedPullRequests(REPO);
  assert.equal(result.length, 2);
  const shipped = result.find((r) => r.number === 20);
  const abandoned = result.find((r) => r.number === 21);
  assert.equal(shipped?.merged, true);
  assert.equal(abandoned?.merged, false);
});

test('listRecentlyClosedPullRequests: a failed list request throws with the real status, not a silent empty array', async () => {
  const client = new GitLabClient(BASE, 'tok', (async () => jsonResponse([], false)) as unknown as typeof fetch);
  await assert.rejects(() => client.listRecentlyClosedPullRequests(REPO), /401 Unauthorized from gitlab\.com/);
});

test('listRecentlyClosedPullRequests: scopes the search server-side to the authenticated user via author_username, once known', async () => {
  const requestedUrls: string[] = [];
  const client = new GitLabClient(BASE, 'tok', (async (url: string) => {
    requestedUrls.push(url);
    if (url.endsWith('/user')) {
      return jsonResponse({ username: 'raj' });
    }
    return jsonResponse([]);
  }) as unknown as typeof fetch);

  await client.getAuthenticatedLogin();
  await client.listRecentlyClosedPullRequests(REPO);

  const listUrls = requestedUrls.filter((url) => url.includes('merge_requests?state='));
  assert.equal(listUrls.length, 2);
  assert.ok(listUrls.every((url) => url.includes('author_username=raj')), listUrls.join('\n'));
});

test('listRecentlyClosedPullRequests: omits author_username when the authenticated user is not yet known', async () => {
  const requestedUrls: string[] = [];
  const client = new GitLabClient(BASE, 'tok', (async (url: string) => {
    requestedUrls.push(url);
    return jsonResponse([]);
  }) as unknown as typeof fetch);

  await client.listRecentlyClosedPullRequests(REPO);

  assert.ok(requestedUrls.every((url) => !url.includes('author_username')), requestedUrls.join('\n'));
});

test('closePullRequest: PUTs state_event=close to the merge request endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitLabClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.closePullRequest(REPO, 22);
  assert.equal(capturedUrl, 'https://gitlab.com/api/v4/projects/acme%2Fwidgets/merge_requests/22');
  assert.equal(capturedInit?.method, 'PUT');
  assert.equal(capturedInit?.body, JSON.stringify({ state_event: 'close' }));
});

test('getPullRequestDiff: synthesizes a diff --git header per file so the shared renderer can split it, and counts +/- lines itself', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      '/merge_requests/23/diffs?per_page=100': [
        { old_path: 'src/a.ts', new_path: 'src/a.ts', diff: '@@ -1,2 +1,3 @@\n-old\n+new1\n+new2' },
        { old_path: 'bin.dat', new_path: 'bin.dat', diff: '' },
      ],
    }),
  );
  const result = await client.getPullRequestDiff(REPO, 23);
  assert.match(result.diff, /diff --git a\/src\/a\.ts b\/src\/a\.ts\n@@ -1,2 \+1,3 @@/);
  assert.deepEqual(result.files, [
    { path: 'src/a.ts', insertions: 2, deletions: 1, binary: false },
    { path: 'bin.dat', insertions: 0, deletions: 0, binary: false },
  ]);
  // No diff fragment for the empty-diff file — nothing to synthesize a header for.
  assert.ok(!result.diff.includes('bin.dat'));
});

test('submitReview: POSTs to the approve endpoint for an approve decision', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitLabClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.submitReview(REPO, 24, 'approve');
  assert.equal(capturedUrl, 'https://gitlab.com/api/v4/projects/acme%2Fwidgets/merge_requests/24/approve');
  assert.equal(capturedInit?.method, 'POST');
});

test('submitReview: a requestChanges decision throws a clear platform-gap error, not a silent no-op — GitLab has no such review state', async () => {
  const client = new GitLabClient(BASE, 'tok', (async () => {
    throw new Error('should never make a request for this decision');
  }) as unknown as typeof fetch);
  await assert.rejects(() => client.submitReview(REPO, 25, 'requestChanges'), /no "Request Changes" review state/);
});

test('addComment: POSTs to the notes endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitLabClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.addComment(REPO, 26, 'Looks good');
  assert.equal(capturedUrl, 'https://gitlab.com/api/v4/projects/acme%2Fwidgets/merge_requests/26/notes');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.body, JSON.stringify({ body: 'Looks good' }));
});

test('listConversationThreads: only resolvable discussions are returned — a plain top-level comment is skipped', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      '/merge_requests/27/discussions?per_page=100': [
        { id: 'd1', notes: [{ body: 'Fix this', author: { username: 'amy' }, resolvable: true, resolved: false }] },
        { id: 'd2', notes: [{ body: 'Already fine', author: { username: 'raj' }, resolvable: true, resolved: true }] },
        { id: 'd3', notes: [{ body: 'Just a comment', author: { username: 'raj' }, resolvable: false, resolved: false }] },
      ],
    }),
  );
  const result = await client.listConversationThreads(REPO, 27);
  assert.deepEqual(result, [
    { id: 'd1', body: 'Fix this', authorLogin: 'amy', resolved: false },
    { id: 'd2', body: 'Already fine', authorLogin: 'raj', resolved: true },
  ]);
});

test('resolveConversationThread: PUTs resolved=true to the discussion endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitLabClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.resolveConversationThread(REPO, 27, 'd1');
  assert.equal(capturedUrl, 'https://gitlab.com/api/v4/projects/acme%2Fwidgets/merge_requests/27/discussions/d1?resolved=true');
  assert.equal(capturedInit?.method, 'PUT');
});
