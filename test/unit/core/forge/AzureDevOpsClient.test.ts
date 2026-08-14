import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AzureDevOpsClient } from '../../../../src/core/forge/AzureDevOpsClient';
import { buildAzureDevOpsIdentity } from '../../../../src/core/forge/azureDevOpsIdentity';
import type { ForgeRepoRef } from '../../../../src/core/forge/types';

const IDENTITY = buildAzureDevOpsIdentity({ organization: 'acme', project: 'Widgets', repository: 'widgets-api' });
const REPO: ForgeRepoRef = { host: 'azureDevOps', identity: IDENTITY, label: 'acme/Widgets/widgets-api' };

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
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

test('getAuthenticatedLogin: reads emailAddress from the org-scoped vssps profile endpoint, not the legacy global host', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    (async (url: string) => {
      assert.ok(url.startsWith('https://vssps.dev.azure.com/acme/'), `expected the org-scoped profile host, got ${url}`);
      return jsonResponse({ emailAddress: 'raj@acme.com' });
    }) as unknown as typeof fetch,
  );
  assert.equal(await client.getAuthenticatedLogin(), 'raj@acme.com');
});

test('getAuthenticatedLogin: falls back to the global vssps host when the identity cannot be parsed', async () => {
  const client = new AzureDevOpsClient(
    'not-a-valid-identity',
    'pat',
    'pat',
    (async (url: string) => {
      assert.ok(url.startsWith('https://app.vssps.visualstudio.com/'), `expected the global profile host, got ${url}`);
      return jsonResponse({ emailAddress: 'raj@acme.com' });
    }) as unknown as typeof fetch,
  );
  assert.equal(await client.getAuthenticatedLogin(), 'raj@acme.com');
});

test('getAuthenticatedLogin: falls back to displayName when emailAddress is absent', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async () => jsonResponse({ displayName: 'Raj Jadon' })) as unknown as typeof fetch);
  assert.equal(await client.getAuthenticatedLogin(), 'Raj Jadon');
});

test('getAuthenticatedLogin: an invalid PAT throws with the real HTTP status, not a generic message', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'bad', 'pat', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.getAuthenticatedLogin(), /401 Unauthorized from vssps\.dev\.azure\.com/);
});

test('credentialScheme "pat": sends the token as HTTP Basic with an empty username', async () => {
  let capturedAuth: string | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'my-pat', 'pat', (async (_url: string, init?: RequestInit) => {
    capturedAuth = (init?.headers as Record<string, string>).Authorization;
    return jsonResponse({ emailAddress: 'raj@acme.com' });
  }) as unknown as typeof fetch);
  await client.getAuthenticatedLogin();
  assert.equal(capturedAuth, `Basic ${Buffer.from(':my-pat').toString('base64')}`);
});

test('credentialScheme "oauth": sends the token as a Bearer, not Basic — a JWT can\'t be Basic-authed', async () => {
  let capturedAuth: string | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'aad-access-token', 'oauth', (async (_url: string, init?: RequestInit) => {
    capturedAuth = (init?.headers as Record<string, string>).Authorization;
    return jsonResponse({ emailAddress: 'raj@acme.com' });
  }) as unknown as typeof fetch);
  await client.getAuthenticatedLogin();
  assert.equal(capturedAuth, 'Bearer aad-access-token');
});

test('listOpenPullRequests: builds the repo URL from organization/project/repository, not owner/repo', async () => {
  let requestedListUrl = '';
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    if (url.includes('pullrequests?searchCriteria.status=active')) {
      requestedListUrl = url;
      return jsonResponse({ value: [] });
    }
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.listOpenPullRequests(REPO);
  assert.ok(requestedListUrl.includes('/acme/Widgets/_apis/git/repositories/widgets-api/'), requestedListUrl);
});

test('listOpenPullRequests: a malformed identity (not 3 parts) returns an empty array rather than throwing', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async () => jsonResponse({ value: [] })) as unknown as typeof fetch);
  const malformed: ForgeRepoRef = { host: 'azureDevOps', identity: 'acme/widgets-api', label: 'acme/widgets-api' };
  assert.deepEqual(await client.listOpenPullRequests(malformed), []);
});

test('listOpenPullRequests: normalizes a plain PR with no reviewers or statuses', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    fakeFetch({
      'searchCriteria.status=active&api-version=7.1': {
        value: [
          {
            pullRequestId: 1,
            title: 'Add feature',
            createdBy: { uniqueName: 'raj@acme.com' },
            creationDate: '2024-01-01T00:00:00Z',
          },
        ],
      },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, 'Add feature');
  assert.equal(result[0]?.authorLogin, 'raj@acme.com');
  assert.equal(result[0]?.url, 'https://dev.azure.com/acme/Widgets/_git/widgets-api/pullrequest/1');
  assert.equal(result[0]?.checkStatus, 'none');
  assert.equal(result[0]?.reviewDecision, 'none');
  assert.equal(result[0]?.hasConflicts, false);
});

test('listOpenPullRequests: a reviewer who rejected (vote -10) -> reviewDecision "changesRequested"', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    fakeFetch({
      'searchCriteria.status=active&api-version=7.1': {
        value: [
          {
            pullRequestId: 2,
            title: 'PR',
            createdBy: { uniqueName: 'raj@acme.com' },
            creationDate: 'c',
            reviewers: [{ uniqueName: 'amy@acme.com', vote: -10 }],
          },
        ],
      },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, 'changesRequested');
  assert.deepEqual(result[0]?.requestedReviewers, ['amy@acme.com']);
});

test('listOpenPullRequests: a reviewer who has not voted (vote 0) -> "reviewRequired"', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    fakeFetch({
      'searchCriteria.status=active&api-version=7.1': {
        value: [
          {
            pullRequestId: 3,
            title: 'PR',
            createdBy: { uniqueName: 'raj@acme.com' },
            creationDate: 'c',
            reviewers: [{ uniqueName: 'amy@acme.com', vote: 0 }],
          },
        ],
      },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, 'reviewRequired');
  assert.deepEqual(result[0]?.requestedReviewers, ['amy@acme.com']);
});

test('listOpenPullRequests: every reviewer approved (vote 10) -> "approved"', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    fakeFetch({
      'searchCriteria.status=active&api-version=7.1': {
        value: [
          {
            pullRequestId: 4,
            title: 'PR',
            createdBy: { uniqueName: 'raj@acme.com' },
            creationDate: 'c',
            reviewers: [{ uniqueName: 'amy@acme.com', vote: 10 }],
          },
        ],
      },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.reviewDecision, 'approved');
  assert.deepEqual(result[0]?.requestedReviewers, []);
});

test('listOpenPullRequests: mergeStatus "conflicts" -> hasConflicts true', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    fakeFetch({
      'searchCriteria.status=active&api-version=7.1': {
        value: [
          {
            pullRequestId: 5,
            title: 'PR',
            createdBy: { uniqueName: 'raj@acme.com' },
            creationDate: 'c',
            mergeStatus: 'conflicts',
          },
        ],
      },
    }),
  );
  const result = await client.listOpenPullRequests(REPO);
  assert.equal(result[0]?.hasConflicts, true);
});

test('listOpenPullRequests: status checks map to checkStatus (succeeded/failed/pending)', async () => {
  async function statusCheck(state: string, expected: string): Promise<void> {
    const client = new AzureDevOpsClient(
      IDENTITY,
      'pat',
      'pat',
      fakeFetch({
        'searchCriteria.status=active&api-version=7.1': {
          value: [
            {
              pullRequestId: 6,
              title: 'PR',
              createdBy: { uniqueName: 'raj@acme.com' },
              creationDate: 'c',
              lastMergeSourceCommit: { commitId: 'sha6' },
            },
          ],
        },
        '/statuses?api-version=7.1': { value: [{ state }] },
      }),
    );
    const result = await client.listOpenPullRequests(REPO);
    assert.equal(result[0]?.checkStatus, expected, `status state "${state}"`);
  }
  await statusCheck('succeeded', 'passing');
  await statusCheck('failed', 'failing');
  await statusCheck('error', 'failing');
  await statusCheck('pending', 'pending');
});

test('listOpenPullRequests: a failed list request throws with the real status, not a silent empty array', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.listOpenPullRequests(REPO), /401 Unauthorized from dev\.azure\.com/);
});

test('listRecentlyClosedPullRequests: combines completed and abandoned, tagging each with the right merged flag', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    if (url.includes('searchCriteria.status=completed')) {
      return jsonResponse({
        value: [{ pullRequestId: 40, title: 'Shipped', createdBy: { uniqueName: 'raj@acme.com' }, creationDate: 'c' }],
      });
    }
    if (url.includes('searchCriteria.status=abandoned')) {
      return jsonResponse({
        value: [{ pullRequestId: 41, title: 'Abandoned', createdBy: { uniqueName: 'raj@acme.com' }, creationDate: 'c' }],
      });
    }
    throw new Error(`unmocked request: ${url}`);
  }) as unknown as typeof fetch);
  const result = await client.listRecentlyClosedPullRequests(REPO);
  assert.equal(result.length, 2);
  assert.equal(result.find((r) => r.number === 40)?.merged, true);
  assert.equal(result.find((r) => r.number === 41)?.merged, false);
});

test('listRecentlyClosedPullRequests: a failed list request throws with the real status, not a silent empty array', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.listRecentlyClosedPullRequests(REPO), /401 Unauthorized from dev\.azure\.com/);
});

test('listRecentlyClosedPullRequests: scopes the search server-side to the authenticated user via searchCriteria.creatorId, once known', async () => {
  const requestedUrls: string[] = [];
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    requestedUrls.push(url);
    if (url.startsWith('https://vssps.dev.azure.com/')) {
      return jsonResponse({ id: 'user-guid-123', emailAddress: 'raj@acme.com' });
    }
    return jsonResponse({ value: [] });
  }) as unknown as typeof fetch);

  await client.getAuthenticatedLogin();
  await client.listRecentlyClosedPullRequests(REPO);

  const listUrls = requestedUrls.filter((url) => url.includes('searchCriteria.status='));
  assert.equal(listUrls.length, 2);
  assert.ok(listUrls.every((url) => url.includes('searchCriteria.creatorId=user-guid-123')), listUrls.join('\n'));
});

test('listRecentlyClosedPullRequests: omits creatorId when the authenticated user is not yet known', async () => {
  const requestedUrls: string[] = [];
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    requestedUrls.push(url);
    return jsonResponse({ value: [] });
  }) as unknown as typeof fetch);

  await client.listRecentlyClosedPullRequests(REPO);

  assert.ok(requestedUrls.every((url) => !url.includes('searchCriteria.creatorId')), requestedUrls.join('\n'));
});

test('closePullRequest: PATCHes status=abandoned to the pull request endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.closePullRequest(REPO, 42);
  assert.equal(
    capturedUrl,
    `https://dev.azure.com/acme/Widgets/_apis/git/repositories/widgets-api/pullrequests/42?api-version=7.1`,
  );
  assert.equal(capturedInit?.method, 'PATCH');
  assert.equal(capturedInit?.body, JSON.stringify({ status: 'abandoned' }));
});

test('reopenPullRequest: PATCHes status=active to the pull request endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.reopenPullRequest(REPO, 42);
  assert.equal(
    capturedUrl,
    `https://dev.azure.com/acme/Widgets/_apis/git/repositories/widgets-api/pullrequests/42?api-version=7.1`,
  );
  assert.equal(capturedInit?.method, 'PATCH');
  assert.equal(capturedInit?.body, JSON.stringify({ status: 'active' }));
});

test('getPullRequestDiff: no diff text is available — returns changed files (leading slash stripped) with 0/0 stats, not fabricated numbers', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    if (url.includes('/iterations?api-version')) {
      return jsonResponse({ value: [{ id: 1 }, { id: 2 }] });
    }
    if (url.includes('/iterations/2/changes')) {
      return jsonResponse({ changeEntries: [{ item: { path: '/src/a.ts' }, changeType: 'edit' }] });
    }
    throw new Error(`unmocked: ${url}`);
  }) as unknown as typeof fetch);
  const result = await client.getPullRequestDiff(REPO, 50);
  assert.equal(result.diff, '');
  assert.deepEqual(result.files, [{ path: 'src/a.ts', insertions: 0, deletions: 0, binary: false }]);
});

test('getPullRequestDiff: a change entry with no item.path (a folder-level entry, in practice) is skipped, not a crash', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    if (url.includes('/iterations?api-version')) {
      return jsonResponse({ value: [{ id: 1 }] });
    }
    if (url.includes('/iterations/1/changes')) {
      return jsonResponse({
        changeEntries: [
          { item: { path: '/src/a.ts' }, changeType: 'edit' },
          { changeType: 'edit' },
          { item: {}, changeType: 'edit' },
        ],
      });
    }
    throw new Error(`unmocked: ${url}`);
  }) as unknown as typeof fetch);
  const result = await client.getPullRequestDiff(REPO, 60);
  assert.deepEqual(result.files, [{ path: 'src/a.ts', insertions: 0, deletions: 0, binary: false }]);
});

test('getPullRequestDiff: uses the latest iteration, not the first', async () => {
  const requestedUrls: string[] = [];
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    requestedUrls.push(url);
    if (url.includes('/iterations?api-version')) {
      return jsonResponse({ value: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    }
    return jsonResponse({ changeEntries: [] });
  }) as unknown as typeof fetch);
  await client.getPullRequestDiff(REPO, 51);
  assert.ok(requestedUrls.some((url) => url.includes('/iterations/3/changes')), requestedUrls.join('\n'));
});

test('submitReview: PUTs vote=10 to the authenticated user\'s own reviewer entry for an approve decision', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://vssps.dev.azure.com/')) {
      return jsonResponse({ id: 'user-guid-123', emailAddress: 'raj@acme.com' });
    }
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.getAuthenticatedLogin();
  await client.submitReview(REPO, 52, 'approve');
  assert.equal(
    capturedUrl,
    'https://dev.azure.com/acme/Widgets/_apis/git/repositories/widgets-api/pullrequests/52/reviewers/user-guid-123?api-version=7.1',
  );
  assert.equal(capturedInit?.method, 'PUT');
  assert.equal(capturedInit?.body, JSON.stringify({ vote: 10 }));
});

test('submitReview: PUTs vote=-10 for a requestChanges decision', async () => {
  let capturedInit: RequestInit | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://vssps.dev.azure.com/')) {
      return jsonResponse({ id: 'user-guid-123' });
    }
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.getAuthenticatedLogin();
  await client.submitReview(REPO, 53, 'requestChanges');
  assert.equal(capturedInit?.body, JSON.stringify({ vote: -10 }));
});

test('submitReview: throws a clear error rather than a confusing 404 when the authenticated user isn\'t known yet', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async () => jsonResponse({})) as unknown as typeof fetch);
  await assert.rejects(() => client.submitReview(REPO, 54, 'approve'), /not signed in yet/);
});

test('addComment: POSTs a new single-comment thread matching the documented shape', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.addComment(REPO, 55, 'Looks good');
  assert.equal(
    capturedUrl,
    'https://dev.azure.com/acme/Widgets/_apis/git/repositories/widgets-api/pullrequests/55/threads?api-version=7.1',
  );
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(
    capturedInit?.body,
    JSON.stringify({ comments: [{ parentCommentId: 0, content: 'Looks good', commentType: 1 }], status: 1 }),
  );
});

test('listConversationThreads: excludes deleted threads and system-generated ones (vote-change notifications)', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    fakeFetch({
      'pullrequests/56/threads?api-version=7.1': {
        value: [
          { id: 1, status: 'active', comments: [{ content: 'Fix this', author: { uniqueName: 'amy@acme.com' }, commentType: 'text' }] },
          { id: 2, status: 'fixed', comments: [{ content: 'Already fine', author: { uniqueName: 'raj@acme.com' }, commentType: 'text' }] },
          { id: 3, status: 'closed', isDeleted: true, comments: [{ content: 'Deleted', author: { uniqueName: 'raj@acme.com' }, commentType: 'text' }] },
          { id: 4, status: 'active', comments: [{ content: 'raj voted 10', author: { uniqueName: 'raj@acme.com' }, commentType: 'system' }] },
        ],
      },
    }),
  );
  const result = await client.listConversationThreads(REPO, 56);
  assert.deepEqual(result, [
    { id: '1', body: 'Fix this', authorLogin: 'amy@acme.com', resolved: false },
    { id: '2', body: 'Already fine', authorLogin: 'raj@acme.com', resolved: true },
  ]);
});

test('listConversationThreads: surfaces the file/line a code thread is anchored to', async () => {
  const client = new AzureDevOpsClient(
    IDENTITY,
    'pat',
    'pat',
    fakeFetch({
      'pullrequests/56/threads?api-version=7.1': {
        value: [
          {
            id: 1,
            status: 'active',
            comments: [{ content: 'Fix this', author: { uniqueName: 'amy@acme.com' }, commentType: 'text' }],
            threadContext: { filePath: '/src/a.ts', rightFileStart: { line: 42 } },
          },
        ],
      },
    }),
  );
  const result = await client.listConversationThreads(REPO, 56);
  assert.deepEqual(result, [{ id: '1', body: 'Fix this', authorLogin: 'amy@acme.com', resolved: false, file: '/src/a.ts', line: 42 }]);
});

test('resolveConversationThread: PATCHes status="fixed" (the enum name, not a number) to the thread endpoint', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  }) as unknown as typeof fetch);
  await client.resolveConversationThread(REPO, 56, '1');
  assert.equal(
    capturedUrl,
    'https://dev.azure.com/acme/Widgets/_apis/git/repositories/widgets-api/pullrequests/56/threads/1?api-version=7.1',
  );
  assert.equal(capturedInit?.method, 'PATCH');
  assert.equal(capturedInit?.body, JSON.stringify({ status: 'fixed' }));
});
