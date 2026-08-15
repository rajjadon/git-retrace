import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../../../../src/core/forge/GitHubClient';
import type { ForgeRepoRef } from '../../../../src/core/forge/types';

const REPO: ForgeRepoRef = { host: 'github', identity: 'acme/widgets', label: 'acme/widgets' };
const BASE = 'https://api.github.com';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string): Response {
  return { ok: true, status: 200, statusText: 'OK', text: async () => body } as unknown as Response;
}

/** Routes a fake fetch by matching against the tail of the requested URL, so each test only wires up the endpoints it actually needs. */
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

test('getAuthenticatedLogin: returns the login from GET /user', async () => {
  const client = new GitHubClient(BASE, 'tok', fakeFetch({ '/user': { login: 'raj' } }));
  assert.equal(await client.getAuthenticatedLogin(), 'raj');
});

test('getAuthenticatedLogin: a failed request (bad/expired token) throws with the real HTTP status, not a generic message', async () => {
  const client = new GitHubClient(BASE, 'bad-tok', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.getAuthenticatedLogin(), /401 Unauthorized from api\.github\.com/);
});

test('listOpenPullRequests: normalizes a plain open PR with no reviews, checks, or requested reviewers', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/repos/acme/widgets/pulls?state=open&per_page=100': [
        {
          number: 1,
          title: 'Add feature',
          html_url: 'https://github.com/acme/widgets/pull/1',
          user: { login: 'raj' },
          draft: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          requested_reviewers: [],
          head: { sha: 'abc123' },
        },
      ],
      '/pulls/1/reviews?per_page=100': [],
      '/commits/abc123/check-runs?per_page=100': { check_runs: [] },
      '/pulls/1': { mergeable_state: 'unknown' },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, 'Add feature');
  assert.equal(result[0]?.authorLogin, 'raj');
  assert.equal(result[0]?.checkStatus, 'none');
  assert.equal(result[0]?.reviewDecision, 'none');
  assert.equal(result[0]?.hasConflicts, false);
});

test('listOpenPullRequests: a requested reviewer who has not submitted a review -> reviewDecision "reviewRequired"', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=open&per_page=100': [
        {
          number: 2,
          title: 'PR',
          html_url: 'u',
          user: { login: 'raj' },
          created_at: 'c',
          updated_at: 'u',
          requested_reviewers: [{ login: 'amy' }],
          head: { sha: 'sha2' },
        },
      ],
      '/reviews?per_page=100': [],
      '/check-runs?per_page=100': { check_runs: [] },
      '/pulls/2': { mergeable_state: 'clean' },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.deepEqual(result[0]?.requestedReviewers, ['amy']);
  assert.equal(result[0]?.reviewDecision, 'reviewRequired');
});

test('listOpenPullRequests: a changes-requested review wins over a stale earlier approval from the same reviewer', () => testReviewDecision(
  [
    { user: { login: 'amy' }, state: 'APPROVED' },
    { user: { login: 'amy' }, state: 'CHANGES_REQUESTED' },
  ],
  [],
  'changesRequested',
));

test('listOpenPullRequests: an approval after an earlier changes-requested from the same reviewer resolves to approved', () => testReviewDecision(
  [
    { user: { login: 'amy' }, state: 'CHANGES_REQUESTED' },
    { user: { login: 'amy' }, state: 'APPROVED' },
  ],
  [],
  'approved',
));

test('listOpenPullRequests: changesRequested takes priority over a still-outstanding requested reviewer', () => testReviewDecision(
  [{ user: { login: 'amy' }, state: 'CHANGES_REQUESTED' }],
  ['bob'],
  'changesRequested',
));

async function testReviewDecision(
  reviews: unknown[],
  requestedReviewers: string[],
  expected: string,
): Promise<void> {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=open&per_page=100': [
        {
          number: 3,
          title: 'PR',
          html_url: 'u',
          user: { login: 'raj' },
          created_at: 'c',
          updated_at: 'u',
          requested_reviewers: requestedReviewers.map((login) => ({ login })),
          head: { sha: 'sha3' },
        },
      ],
      '/reviews?per_page=100': reviews,
      '/check-runs?per_page=100': { check_runs: [] },
      '/pulls/3': { mergeable_state: 'clean' },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, expected);
}

test('listOpenPullRequests: an in-progress check run -> checkStatus "pending", even if another already failed', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=open&per_page=100': [
        { number: 4, title: 'PR', html_url: 'u', user: { login: 'raj' }, created_at: 'c', updated_at: 'u', head: { sha: 'sha4' } },
      ],
      '/reviews?per_page=100': [],
      '/check-runs?per_page=100': {
        check_runs: [
          { status: 'completed', conclusion: 'failure' },
          { status: 'in_progress', conclusion: null },
        ],
      },
      '/pulls/4': { mergeable_state: 'clean' },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.checkStatus, 'pending');
});

test('listOpenPullRequests: all check runs completed and successful -> checkStatus "passing"', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=open&per_page=100': [
        { number: 5, title: 'PR', html_url: 'u', user: { login: 'raj' }, created_at: 'c', updated_at: 'u', head: { sha: 'sha5' } },
      ],
      '/reviews?per_page=100': [],
      '/check-runs?per_page=100': { check_runs: [{ status: 'completed', conclusion: 'success' }] },
      '/pulls/5': { mergeable_state: 'clean' },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.checkStatus, 'passing');
});

test('listOpenPullRequests: mergeable_state "dirty" -> hasConflicts true', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=open&per_page=100': [
        { number: 6, title: 'PR', html_url: 'u', user: { login: 'raj' }, created_at: 'c', updated_at: 'u', head: { sha: 'sha6' } },
      ],
      '/reviews?per_page=100': [],
      '/check-runs?per_page=100': { check_runs: [] },
      '/pulls/6': { mergeable_state: 'dirty' },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.hasConflicts, true);
});

test('listOpenPullRequests: mergeable_state null (still computing) is treated as no known conflict', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=open&per_page=100': [
        { number: 7, title: 'PR', html_url: 'u', user: { login: 'raj' }, created_at: 'c', updated_at: 'u', head: { sha: 'sha7' } },
      ],
      '/reviews?per_page=100': [],
      '/check-runs?per_page=100': { check_runs: [] },
      '/pulls/7': { mergeable_state: null },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.hasConflicts, false);
});

test('listOpenPullRequests: a failed list request throws with the real status, not a silent empty array', async () => {
  const client = new GitHubClient(BASE, 'tok', (async () => jsonResponse([], false)) as unknown as typeof fetch);
  await assert.rejects(() => client.listOpenPullRequests(REPO), /401 Unauthorized from api\.github\.com/);
});

test('listOpenPullRequests: a network failure on an enrichment call degrades that field instead of throwing for the whole PR', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    (async (url: string) => {
      if (url.includes('/check-runs')) {
        throw new Error('network down');
      }
      if (url.endsWith('/pulls?state=open&per_page=100')) {
        return jsonResponse([
          { number: 8, title: 'PR', html_url: 'u', user: { login: 'raj' }, created_at: 'c', updated_at: 'u', head: { sha: 'sha8' } },
        ]);
      }
      if (url.endsWith('/reviews?per_page=100')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/pulls/8')) {
        return jsonResponse({ mergeable_state: 'clean' });
      }
      throw new Error(`unmocked: ${url}`);
    }) as unknown as typeof fetch,
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.checkStatus, 'none');
});

test('listOpenPullRequests: reviewedByMe is true when the authenticated user has a review on this PR, regardless of its state', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/user': { login: 'raj' },
      '/pulls?state=open&per_page=100': [
        { number: 30, title: 'PR', html_url: 'u', user: { login: 'someone-else' }, created_at: 'c', updated_at: 'u', head: { sha: 'sha30' } },
      ],
      '/reviews?per_page=100': [{ user: { login: 'raj' }, state: 'COMMENTED' }],
      '/check-runs?per_page=100': { check_runs: [] },
      '/pulls/30': { mergeable_state: 'clean' },
    }),
  );
  await client.getAuthenticatedLogin();
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewedByMe, true);
});

test('listOpenPullRequests: reviewedByMe is false when the authenticated user has not reviewed this PR yet', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/user': { login: 'raj' },
      '/pulls?state=open&per_page=100': [
        { number: 31, title: 'PR', html_url: 'u', user: { login: 'someone-else' }, created_at: 'c', updated_at: 'u', head: { sha: 'sha31' } },
      ],
      '/reviews?per_page=100': [{ user: { login: 'amy' }, state: 'APPROVED' }],
      '/check-runs?per_page=100': { check_runs: [] },
      '/pulls/31': { mergeable_state: 'clean' },
    }),
  );
  await client.getAuthenticatedLogin();
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewedByMe, false);
});

test('listRecentlyClosedPullRequests: reviewedByMe is always false — nothing reads it on a closed/merged PR', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=closed&sort=updated&direction=desc&per_page=100': [
        {
          number: 32,
          title: 'Shipped',
          html_url: 'u',
          user: { login: 'raj' },
          created_at: 'c',
          updated_at: 'u',
          closed_at: 'c2',
          merged_at: 'c2',
        },
      ],
    }),
  );
  const result = await client.listRecentlyClosedPullRequests(REPO);
  assert.equal(result[0]?.reviewedByMe, false);
});

test('listRecentlyClosedPullRequests: merged_at present -> merged true, and closedAt uses closed_at', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=closed&sort=updated&direction=desc&per_page=100': [
        {
          number: 10,
          title: 'Shipped feature',
          html_url: 'https://github.com/acme/widgets/pull/10',
          user: { login: 'raj' },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-05T00:00:00Z',
          closed_at: '2024-01-05T00:00:00Z',
          merged_at: '2024-01-05T00:00:00Z',
        },
      ],
    }),
  );
  const result = await client.listRecentlyClosedPullRequests(REPO);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.merged, true);
  assert.equal(result[0]?.closedAt, '2024-01-05T00:00:00Z');
});

test('listRecentlyClosedPullRequests: merged_at null -> merged false (closed without merging)', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/pulls?state=closed&sort=updated&direction=desc&per_page=100': [
        {
          number: 11,
          title: 'Abandoned idea',
          html_url: 'u',
          user: { login: 'raj' },
          created_at: 'c',
          updated_at: 'u',
          closed_at: '2024-01-06T00:00:00Z',
          merged_at: null,
        },
      ],
    }),
  );
  const result = await client.listRecentlyClosedPullRequests(REPO);
  assert.equal(result[0]?.merged, false);
});

test('listRecentlyClosedPullRequests: a failed list request throws with the real status, not a silent empty array', async () => {
  const client = new GitHubClient(BASE, 'tok', (async () => jsonResponse([], false)) as unknown as typeof fetch);
  await assert.rejects(() => client.listRecentlyClosedPullRequests(REPO), /401 Unauthorized from api\.github\.com/);
});

test('closePullRequest: PATCHes state=closed to the PR endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.closePullRequest(REPO, 12);
  assert.equal(capturedUrl, 'https://api.github.com/repos/acme/widgets/pulls/12');
  assert.equal(capturedInit?.method, 'PATCH');
  assert.equal(capturedInit?.body, JSON.stringify({ state: 'closed' }));
});

test('closePullRequest: a rejected request throws with the real HTTP status', async () => {
  const client = new GitHubClient(BASE, 'tok', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.closePullRequest(REPO, 13), /401 Unauthorized from api\.github\.com/);
});

test('reopenPullRequest: PATCHes state=open to the PR endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.reopenPullRequest(REPO, 12);
  assert.equal(capturedUrl, 'https://api.github.com/repos/acme/widgets/pulls/12');
  assert.equal(capturedInit?.method, 'PATCH');
  assert.equal(capturedInit?.body, JSON.stringify({ state: 'open' }));
});

test('getPullRequestDiff: fetches raw diff text via the diff media type, and stats from /files', async () => {
  let capturedAccept: string | undefined;
  const client = new GitHubClient(
    BASE,
    'tok',
    (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/pulls/14/files?per_page=100')) {
        return jsonResponse([
          { filename: 'src/a.ts', additions: 3, deletions: 1, patch: '@@ -1 +1,3 @@\n+x' },
          { filename: 'image.png', additions: 0, deletions: 0 },
        ]);
      }
      if (url.endsWith('/pulls/14')) {
        capturedAccept = (init?.headers as Record<string, string>).Accept;
        return textResponse('diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1,3 @@\n+x');
      }
      throw new Error(`unmocked: ${url}`);
    }) as unknown as typeof fetch,
  );
  const result = await client.getPullRequestDiff(REPO, 14);
  assert.equal(capturedAccept, 'application/vnd.github.v3.diff');
  assert.match(result.diff, /diff --git a\/src\/a\.ts/);
  assert.deepEqual(result.files, [
    { path: 'src/a.ts', insertions: 3, deletions: 1, binary: false },
    { path: 'image.png', insertions: 0, deletions: 0, binary: true },
  ]);
});

test('submitReview: POSTs event=APPROVE for an approve decision', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.submitReview(REPO, 15, 'approve');
  assert.equal(capturedUrl, 'https://api.github.com/repos/acme/widgets/pulls/15/reviews');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.body, JSON.stringify({ event: 'APPROVE' }));
});

test('submitReview: POSTs event=REQUEST_CHANGES for a requestChanges decision', async () => {
  let capturedInit: RequestInit | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (_url: string, init?: RequestInit) => {
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.submitReview(REPO, 16, 'requestChanges');
  assert.equal(capturedInit?.body, JSON.stringify({ event: 'REQUEST_CHANGES' }));
});

test('addComment: POSTs to the issue-comments endpoint (PRs are issues for comments on GitHub)', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.addComment(REPO, 17, 'Looks good');
  assert.equal(capturedUrl, 'https://api.github.com/repos/acme/widgets/issues/17/comments');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.body, JSON.stringify({ body: 'Looks good' }));
});

test('listConversationThreads: POSTs a GraphQL query to /graphql (not REST) and normalizes the reviewThreads response', async () => {
  let capturedUrl: string | undefined;
  let capturedBody: { query: string; variables: Record<string, unknown> } | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedBody = JSON.parse(String(init?.body));
    return jsonResponse({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                { id: 'PRRT_1', isResolved: false, comments: { nodes: [{ body: 'Fix this', author: { login: 'amy' } }] } },
                { id: 'PRRT_2', isResolved: true, comments: { nodes: [{ body: 'Already fine', author: { login: 'raj' } }] } },
              ],
            },
          },
        },
      },
    });
  }) as unknown as typeof fetch);
  const result = await client.listConversationThreads(REPO, 18);
  assert.equal(capturedUrl, 'https://api.github.com/graphql');
  assert.match(capturedBody?.query ?? '', /reviewThreads/);
  assert.deepEqual(capturedBody?.variables, { owner: 'acme', name: 'widgets', number: 18 });
  assert.deepEqual(result, [
    { id: 'PRRT_1', body: 'Fix this', authorLogin: 'amy', resolved: false },
    { id: 'PRRT_2', body: 'Already fine', authorLogin: 'raj', resolved: true },
  ]);
});

test('listConversationThreads: surfaces the file/line a review comment is anchored to', async () => {
  const client = new GitHubClient(BASE, 'tok', (async () =>
    jsonResponse({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'PRRT_1',
                  isResolved: false,
                  path: 'src/a.ts',
                  line: 42,
                  originalLine: 40,
                  comments: { nodes: [{ body: 'Fix this', author: { login: 'amy' } }] },
                },
                {
                  // Outdated — the thread's commit is no longer part of the PR, so `line` is null
                  // and `originalLine` (always set for a line comment) is the fallback.
                  id: 'PRRT_2',
                  isResolved: false,
                  path: 'src/b.ts',
                  line: null,
                  originalLine: 7,
                  comments: { nodes: [{ body: 'Also fix this', author: { login: 'amy' } }] },
                },
              ],
            },
          },
        },
      },
    })) as unknown as typeof fetch);
  const result = await client.listConversationThreads(REPO, 18);
  assert.deepEqual(result, [
    { id: 'PRRT_1', body: 'Fix this', authorLogin: 'amy', resolved: false, file: 'src/a.ts', line: 42 },
    { id: 'PRRT_2', body: 'Also fix this', authorLogin: 'amy', resolved: false, file: 'src/b.ts', line: 7 },
  ]);
});

test('resolveConversationThread: POSTs the resolveReviewThread mutation with the thread id', async () => {
  let capturedBody: { query: string; variables: Record<string, unknown> } | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return jsonResponse({ data: { resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: true } } } });
  }) as unknown as typeof fetch);
  await client.resolveConversationThread(REPO, 18, 'PRRT_1');
  assert.match(capturedBody?.query ?? '', /resolveReviewThread/);
  assert.deepEqual(capturedBody?.variables, { threadId: 'PRRT_1' });
});

test('GraphQL calls throw the real error message when GitHub returns a 200 with an "errors" array', async () => {
  const client = new GitHubClient(BASE, 'tok', (async () =>
    jsonResponse({ errors: [{ message: 'Could not resolve to a PullRequest' }] })) as unknown as typeof fetch);
  await assert.rejects(() => client.resolveConversationThread(REPO, 18, 'bad-id'), /Could not resolve to a PullRequest/);
});

test('GraphQL calls against a GitHub Enterprise Server apiBaseUrl use <host>/api/graphql, not <host>/api/v3/graphql', async () => {
  let capturedUrl: string | undefined;
  const client = new GitHubClient('https://ghe.example.com/api/v3', 'tok', (async (url: string) => {
    capturedUrl = url;
    return jsonResponse({ data: { resolveReviewThread: { thread: { id: 'x', isResolved: true } } } });
  }) as unknown as typeof fetch);
  await client.resolveConversationThread(REPO, 18, 'x');
  assert.equal(capturedUrl, 'https://ghe.example.com/api/graphql');
});

test('mergePullRequest: PUTs merge_method to the merge endpoint, one call per strategy', async () => {
  for (const strategy of ['merge', 'squash', 'rebase'] as const) {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const client = new GitHubClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse({});
    }) as unknown as typeof fetch);
    await client.mergePullRequest(REPO, 20, { strategy, deleteSourceBranch: false });
    assert.equal(capturedUrl, 'https://api.github.com/repos/acme/widgets/pulls/20/merge');
    assert.equal(capturedInit?.method, 'PUT');
    assert.equal(capturedInit?.body, JSON.stringify({ merge_method: strategy }));
  }
});

test('mergePullRequest: deleteSourceBranch fetches the head ref and deletes it, URL-encoding a slash in the branch name', async () => {
  const calls: string[] = [];
  const client = new GitHubClient(
    BASE,
    'tok',
    (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/pulls/21/merge')) {
        return jsonResponse({});
      }
      if (url.endsWith('/pulls/21')) {
        return jsonResponse({ head: { ref: 'feature/x' } });
      }
      if (url.endsWith('/git/refs/heads/feature%2Fx')) {
        return jsonResponse({});
      }
      throw new Error(`unmocked: ${url}`);
    }) as unknown as typeof fetch,
  );
  await client.mergePullRequest(REPO, 21, { strategy: 'squash', deleteSourceBranch: true });
  assert.ok(calls.includes('DELETE https://api.github.com/repos/acme/widgets/git/refs/heads/feature%2Fx'));
});

test('mergePullRequest: deleteSourceBranch false never fetches or deletes the head ref', async () => {
  let calls = 0;
  const client = new GitHubClient(BASE, 'tok', (async (url: string) => {
    calls++;
    if (url.endsWith('/pulls/22/merge')) {
      return jsonResponse({});
    }
    throw new Error(`unexpected call: ${url}`);
  }) as unknown as typeof fetch);
  await client.mergePullRequest(REPO, 22, { strategy: 'merge', deleteSourceBranch: false });
  assert.equal(calls, 1);
});

test('mergePullRequest: a rejected request throws with the real HTTP status', async () => {
  const client = new GitHubClient(BASE, 'tok', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(
    () => client.mergePullRequest(REPO, 23, { strategy: 'merge', deleteSourceBranch: false }),
    /401 Unauthorized from api\.github\.com/,
  );
});

test('createPullRequest: POSTs head/base/draft to the pulls endpoint, mapping the response into a PullRequestSummary', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new GitHubClient(BASE, 'tok', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({
      number: 50,
      title: 'Add feature',
      html_url: 'https://github.com/acme/widgets/pull/50',
      user: { login: 'raj' },
      draft: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });
  }) as unknown as typeof fetch);
  const result = await client.createPullRequest(REPO, { title: 'Add feature', base: 'main', compare: 'feature-x', draft: true });
  assert.equal(capturedUrl, 'https://api.github.com/repos/acme/widgets/pulls');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.body, JSON.stringify({ title: 'Add feature', head: 'feature-x', base: 'main', draft: true }));
  assert.equal(result.number, 50);
  assert.equal(result.url, 'https://github.com/acme/widgets/pull/50');
  assert.equal(result.isDraft, true);
  assert.equal(result.reviewedByMe, false);
});

test('createPullRequest: a rejected request throws with the real HTTP status', async () => {
  const client = new GitHubClient(BASE, 'tok', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(
    () => client.createPullRequest(REPO, { title: 'x', base: 'main', compare: 'feature', draft: false }),
    /401 Unauthorized from api\.github\.com/,
  );
});
