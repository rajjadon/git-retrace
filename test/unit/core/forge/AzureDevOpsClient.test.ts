import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AzureDevOpsClient } from '../../../../src/core/forge/AzureDevOpsClient';
import { buildAzureDevOpsIdentity } from '../../../../src/core/forge/azureDevOpsIdentity';
import type { ForgeRepoRef } from '../../../../src/core/forge/types';

const IDENTITY = buildAzureDevOpsIdentity({ organization: 'acme', project: 'Widgets', repository: 'widgets-api' });
const REPO: ForgeRepoRef = { host: 'azureDevOps', identity: IDENTITY, label: 'acme/Widgets/widgets-api' };

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

test('getAuthenticatedLogin: reads emailAddress from the vssps profile endpoint, a different host than the main API', async () => {
  const client = new AzureDevOpsClient(
    'pat',
    (async (url: string) => {
      assert.ok(url.startsWith('https://app.vssps.visualstudio.com/'), `expected the profile host, got ${url}`);
      return jsonResponse({ emailAddress: 'raj@acme.com' });
    }) as unknown as typeof fetch,
  );
  assert.equal(await client.getAuthenticatedLogin(), 'raj@acme.com');
});

test('getAuthenticatedLogin: falls back to displayName when emailAddress is absent', async () => {
  const client = new AzureDevOpsClient('pat', (async () => jsonResponse({ displayName: 'Raj Jadon' })) as unknown as typeof fetch);
  assert.equal(await client.getAuthenticatedLogin(), 'Raj Jadon');
});

test('getAuthenticatedLogin: an invalid PAT throws with the real HTTP status, not a generic message', async () => {
  const client = new AzureDevOpsClient('bad', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  await assert.rejects(() => client.getAuthenticatedLogin(), /401 Unauthorized from app\.vssps\.visualstudio\.com/);
});

test('listOpenPullRequests: builds the repo URL from organization/project/repository, not owner/repo', async () => {
  let requestedListUrl = '';
  const client = new AzureDevOpsClient('pat', (async (url: string) => {
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
  const client = new AzureDevOpsClient('pat', (async () => jsonResponse({ value: [] })) as unknown as typeof fetch);
  const malformed: ForgeRepoRef = { host: 'azureDevOps', identity: 'acme/widgets-api', label: 'acme/widgets-api' };
  assert.deepEqual(await client.listOpenPullRequests(malformed), []);
});

test('listOpenPullRequests: normalizes a plain PR with no reviewers or statuses', async () => {
  const client = new AzureDevOpsClient(
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

test('listOpenPullRequests: a failed list request returns an empty array, not a throw', async () => {
  const client = new AzureDevOpsClient('pat', (async () => jsonResponse({}, false)) as unknown as typeof fetch);
  assert.deepEqual(await client.listOpenPullRequests(REPO), []);
});
