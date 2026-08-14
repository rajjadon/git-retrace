import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { MANIFEST_PATH, type FixtureManifest } from '../fixtures/build-fixture-repo';
import type { GitLoreTestApi } from '../../src/extension';
import { COMMANDS, CONFIG } from '../../src/constants';
import { EXTENSION_ID } from './extensionId';

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Slices out one column's own HTML — an unbounded `data-bucket="x"[\s\S]*?text` regex would happily match text that actually landed in a *later* column, since columns share one document and nothing stops the match at the column boundary. */
function columnHtml(html: string, bucket: string): string {
  const start = html.indexOf(`data-bucket="${bucket}"`);
  assert.ok(start !== -1, `no column found for bucket "${bucket}"`);
  const nextColumn = html.indexOf('<div class="column"', start + 1);
  return html.slice(start, nextColumn === -1 ? undefined : nextColumn);
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

suite('Launchpad', () => {
  let manifest: FixtureManifest;
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest;
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  async function withLaunchpadEnabled<T>(fn: () => Promise<T>): Promise<T> {
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    await config.update('launchpad.enabled', true, vscode.ConfigurationTarget.Global);
    try {
      return await fn();
    } finally {
      await config.update('launchpad.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  }

  /** The whole integration suite runs against one fixed workspace folder (the shared fixture repo) — this adds a remote to it for the duration of `fn`, then removes it, so other suites relying on "no remote" are unaffected. Nest calls (different names) to exercise multi-remote scanning. */
  async function withRemote<T>(name: string, url: string, fn: () => Promise<T>): Promise<T> {
    execFileSync('git', ['remote', 'add', name, url], { cwd: manifest.repoRoot });
    try {
      return await fn();
    } finally {
      execFileSync('git', ['remote', 'remove', name], { cwd: manifest.repoRoot });
    }
  }

  async function withOriginRemote<T>(url: string, fn: () => Promise<T>): Promise<T> {
    return withRemote('origin', url, fn);
  }

  test('registers the gitLore.openLaunchpad command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(COMMANDS.openLaunchpad));
  });

  test('disabled by default: shows an info message and opens no panel', async () => {
    let message: string | undefined;
    const original = vscode.window.showInformationMessage;
    (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage = ((
      msg: string,
    ) => {
      message = msg;
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showInformationMessage;
    try {
      await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
    } finally {
      vscode.window.showInformationMessage = original;
    }
    assert.match(message ?? '', /Launchpad is disabled/);
    assert.equal(api.getLaunchpadHtml(), undefined);
  });

  test('enabled, with no recognized git-forge remote in the workspace: shows the placeholder', async () =>
    withLaunchpadEnabled(async () => {
      await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
      await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('No recognized git-forge remotes'));
      assert.match(api.getLaunchpadHtml() ?? '', /No recognized git-forge remotes/);
    }));

  test('enabled, with a GitLab remote: prompts for a PAT, fetches, categorizes, and renders real PR data', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/widgets.git', async () => {
        api.launchpadProvider.setFetchImplForTest((async (url: string) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([
              {
                iid: 7,
                title: 'Add real feature',
                web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/7',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Add real feature'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        const html = api.getLaunchpadHtml() ?? '';
        assert.match(html, /Add real feature/);
        assert.match(html, /acme\/widgets/);
        // Authored by "raj" (the mocked authenticated login), not yet approved -> my own PR still waiting.
        assert.match(columnHtml(html, 'waiting'), /Add real feature/);
      }),
    ));

  test('enabled, with a rejected token: shows the real HTTP status (not a generic message) and re-prompts on the next refresh', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/rejected.git', async () => {
        let promptCount = 0;
        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () => {
          promptCount++;
          return 'fake-pat';
        }) as typeof vscode.window.showInputBox;

        api.launchpadProvider.setFetchImplForTest((async () => ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({}),
          text: async () => '{}',
        })) as unknown as typeof fetch);

        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          // The error banner escapes HTML entities, so the apostrophe renders as `&#39;`, not `'`.
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Couldn&#39;t authenticate'));
          const html = api.getLaunchpadHtml() ?? '';
          assert.match(html, /Couldn&#39;t authenticate with gitlab\.com: 401 Unauthorized from gitlab\.com/);

          // Another test earlier in this suite may have already cached a gitlab.com PAT, so this
          // refresh might reuse it (0 prompts) rather than prompt fresh (1 prompt) — either way,
          // the rejected token should now be cleared, so the *next* refresh always needs exactly
          // one more prompt than this one did, instead of silently retrying the same bad credential.
          const promptCountAfterFirstRefresh = promptCount;
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => promptCount === promptCountAfterFirstRefresh + 1);
        } finally {
          vscode.window.showInputBox = originalInput;
        }
      }),
    ));

  test('enabled, with an Azure DevOps SSH remote (git@ssh.dev.azure.com:v3/org/project/repo): fetches and renders real PR data', async () =>
    withLaunchpadEnabled(() =>
      withRemote('origin', 'git@ssh.dev.azure.com:v3/GoFynd/FyndOne/Boltic', async () => {
        api.launchpadProvider.setFetchImplForTest((async (url: string) => {
          // Org-scoped, not the legacy global `app.vssps.visualstudio.com` host — see
          // `AzureDevOpsClient.getAuthenticatedLogin`.
          if (url.startsWith('https://vssps.dev.azure.com/')) {
            return jsonResponse({ emailAddress: 'raj@example.com' });
          }
          if (url.includes('/pullrequests?searchCriteria.status=active')) {
            return jsonResponse({
              value: [
                {
                  pullRequestId: 5,
                  title: 'Azure DevOps PR',
                  createdBy: { uniqueName: 'raj@example.com' },
                  creationDate: '2024-01-01T00:00:00Z',
                  reviewers: [],
                },
              ],
            });
          }
          if (
            url.includes('/pullrequests?searchCriteria.status=completed') ||
            url.includes('/pullrequests?searchCriteria.status=abandoned')
          ) {
            return jsonResponse({ value: [] });
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        // `dev.azure.com` resolves its credential via VS Code's built-in Microsoft/AAD session,
        // not a PAT prompt (see `forgeCredentials.ts`'s `resolveForgeToken`) — mock that session
        // instead of `showInputBox`.
        const originalGetSession = vscode.authentication.getSession;
        (vscode.authentication as { getSession: typeof vscode.authentication.getSession }).getSession = (async () => ({
          id: 'fake-session',
          accessToken: 'fake-oauth-token',
          account: { id: 'fake-account', label: 'raj' },
          scopes: [],
        })) as typeof vscode.authentication.getSession;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Azure DevOps PR'));
        } finally {
          vscode.authentication.getSession = originalGetSession;
        }

        const html = api.getLaunchpadHtml() ?? '';
        assert.match(html, /Azure DevOps PR/);
        assert.match(html, /GoFynd\/FyndOne\/Boltic/);
      }),
    ));

  test('with remotes on two different repos (origin + upstream): both are scanned and both PRs render', async () =>
    withLaunchpadEnabled(() =>
      withRemote('origin', 'https://gitlab.com/acme/widgets.git', () =>
        withRemote('upstream', 'https://gitlab.com/acme/sprockets.git', async () => {
          api.launchpadProvider.setFetchImplForTest((async (url: string) => {
            if (url.endsWith('/user')) {
              return jsonResponse({ username: 'raj' });
            }
            if (url.includes('acme%2Fwidgets/merge_requests?state=opened')) {
              return jsonResponse([
                {
                  iid: 1,
                  title: 'Widgets PR',
                  web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/1',
                  author: { username: 'raj' },
                  created_at: '2024-01-01T00:00:00Z',
                  updated_at: '2024-01-01T00:00:00Z',
                },
              ]);
            }
            if (url.includes('acme%2Fsprockets/merge_requests?state=opened')) {
              return jsonResponse([
                {
                  iid: 2,
                  title: 'Sprockets PR',
                  web_url: 'https://gitlab.com/acme/sprockets/-/merge_requests/2',
                  author: { username: 'raj' },
                  created_at: '2024-01-01T00:00:00Z',
                  updated_at: '2024-01-01T00:00:00Z',
                },
              ]);
            }
            if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
              return jsonResponse([]);
            }
            if (url.endsWith('/approvals')) {
              return jsonResponse({ approved: false, approved_by: [] });
            }
            throw new Error(`unmocked request in test: ${url}`);
          }) as unknown as typeof fetch);

          const originalInput = vscode.window.showInputBox;
          (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
            'fake-pat') as typeof vscode.window.showInputBox;
          try {
            await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
            await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Sprockets PR'));
          } finally {
            vscode.window.showInputBox = originalInput;
          }

          const html = api.getLaunchpadHtml() ?? '';
          assert.match(html, /Widgets PR/);
          assert.match(html, /Sprockets PR/);
        }),
      ),
    ));

  test('with two remotes pointing at the same repo (origin + mirror): scanned once, not duplicated', async () =>
    withLaunchpadEnabled(() =>
      withRemote('origin', 'https://gitlab.com/acme/widgets.git', () =>
        withRemote('mirror', 'https://gitlab.com/acme/widgets.git', async () => {
          let listCalls = 0;
          api.launchpadProvider.setFetchImplForTest((async (url: string) => {
            if (url.endsWith('/user')) {
              return jsonResponse({ username: 'raj' });
            }
            if (url.includes('merge_requests?state=opened')) {
              listCalls++;
              return jsonResponse([
                {
                  iid: 3,
                  title: 'Deduped PR',
                  web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/3',
                  author: { username: 'raj' },
                  created_at: '2024-01-01T00:00:00Z',
                  updated_at: '2024-01-01T00:00:00Z',
                },
              ]);
            }
            if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
              return jsonResponse([]);
            }
            if (url.endsWith('/approvals')) {
              return jsonResponse({ approved: false, approved_by: [] });
            }
            throw new Error(`unmocked request in test: ${url}`);
          }) as unknown as typeof fetch);

          const originalInput = vscode.window.showInputBox;
          (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
            'fake-pat') as typeof vscode.window.showInputBox;
          try {
            await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
            await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Deduped PR'));
          } finally {
            vscode.window.showInputBox = originalInput;
          }

          const html = api.getLaunchpadHtml() ?? '';
          assert.equal(listCalls, 1, 'the same repo identity reached via two remotes should only be fetched once');
          // The title legitimately repeats within a single card (card aria-label, visible title, snooze button
          // aria-label) — count the card's own data-url attribute instead, which appears exactly once per card.
          const cardCount = html.split('data-url="https://gitlab.com/acme/widgets/-/merge_requests/3"').length - 1;
          assert.equal(cardCount, 1, 'the PR card should render exactly once, not once per remote');
        }),
      ),
    ));

  test('snoozing a PR moves it to the Snoozed column on the next refresh', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/widgets.git', async () => {
        api.launchpadProvider.setFetchImplForTest((async (url: string) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([
              {
                iid: 9,
                title: 'Snoozable PR',
                web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/9',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Snoozable PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        const before = api.getLaunchpadHtml() ?? '';
        assert.match(columnHtml(before, 'waiting'), /Snoozable PR/);
        assert.ok(!columnHtml(before, 'snoozed').includes('Snoozable PR'));

        await api.launchpadProvider.toggleSnoozeForTest('gitlab:acme/widgets#9');
        const html = api.getLaunchpadHtml() ?? '';
        assert.match(columnHtml(html, 'snoozed'), /Snoozable PR/);
        assert.ok(!columnHtml(html, 'waiting').includes('Snoozable PR'));

        // Clean up the persisted snooze state so it doesn't leak into a later test run.
        await api.launchpadProvider.toggleSnoozeForTest('gitlab:acme/widgets#9');
      }),
    ));

  test('a recently merged and a recently closed PR render in the "Merged" and "Closed" columns', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/widgets.git', async () => {
        api.launchpadProvider.setFetchImplForTest((async (url: string) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([]);
          }
          if (url.includes('merge_requests?state=merged')) {
            return jsonResponse([
              {
                iid: 50,
                title: 'Shipped feature',
                web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/50',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-03T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=closed')) {
            return jsonResponse([
              {
                iid: 51,
                title: 'Abandoned idea',
                web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/51',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-04T00:00:00Z',
              },
            ]);
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Shipped feature'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        const html = api.getLaunchpadHtml() ?? '';
        assert.match(columnHtml(html, 'merged'), /Shipped feature/);
        assert.match(columnHtml(html, 'closed'), /Abandoned idea/);
        assert.ok(!columnHtml(html, 'closed').includes('Shipped feature'));
        assert.ok(!columnHtml(html, 'merged').includes('Abandoned idea'));
      }),
    ));

  test('closing a PR calls the client and removes it from the board on the next refresh', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/widgets.git', async () => {
        let closeCalled = false;
        let openCallCount = 0;
        api.launchpadProvider.setFetchImplForTest((async (url: string, init?: RequestInit) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            openCallCount++;
            return jsonResponse(
              openCallCount === 1
                ? [
                    {
                      iid: 60,
                      title: 'Closable PR',
                      web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/60',
                      author: { username: 'raj' },
                      created_at: '2024-01-01T00:00:00Z',
                      updated_at: '2024-01-01T00:00:00Z',
                    },
                  ]
                : [],
            );
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          if (url.endsWith('/merge_requests/60') && init?.method === 'PUT') {
            closeCalled = true;
            assert.equal(init.body, JSON.stringify({ state_event: 'close' }));
            return jsonResponse({});
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Closable PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        await api.launchpadProvider.closePullRequestForTest('gitlab:acme/widgets#60');
        assert.ok(closeCalled, 'expected the close endpoint to be called');
        await waitFor(() => !(api.getLaunchpadHtml() ?? '').includes('Closable PR'));
      }),
    ));

  test('reopening a closed (not merged) PR calls the client\'s reopen endpoint', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/widgets.git', async () => {
        let reopenCalled = false;
        api.launchpadProvider.setFetchImplForTest((async (url: string, init?: RequestInit) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened') || url.includes('merge_requests?state=merged')) {
            return jsonResponse([]);
          }
          if (url.includes('merge_requests?state=closed')) {
            return jsonResponse([
              {
                iid: 70,
                title: 'Reopenable PR',
                web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/70',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-04T00:00:00Z',
              },
            ]);
          }
          if (url.endsWith('/merge_requests/70') && init?.method === 'PUT') {
            reopenCalled = true;
            assert.equal(init.body, JSON.stringify({ state_event: 'reopen' }));
            return jsonResponse({});
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Reopenable PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        await api.launchpadProvider.reopenPullRequestForTest('gitlab:acme/widgets#70');
        assert.ok(reopenCalled, 'expected the reopen endpoint to be called');
      }),
    ));

  test('approving a PR calls the client\'s approve endpoint', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/widgets.git', async () => {
        let approveCalled = false;
        api.launchpadProvider.setFetchImplForTest((async (url: string, init?: RequestInit) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([
              {
                iid: 61,
                title: 'Reviewable PR',
                web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/61',
                // A different author than the signed-in user ('raj', mocked via /user below) —
                // Launchpad now refuses to submit a review on your own PR before ever calling the
                // API, so this needs to be someone else's PR to actually exercise the approve call.
                author: { username: 'other-dev' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          if (url.endsWith('/merge_requests/61/approve') && init?.method === 'POST') {
            approveCalled = true;
            return jsonResponse({});
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Reviewable PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        await api.launchpadProvider.submitReviewForTest('gitlab:acme/widgets#61', 'approve');
        assert.ok(approveCalled, 'expected the approve endpoint to be called');
      }),
    ));

  test('submitting a review on your own PR never calls the host — every host rejects self-review anyway, so this is caught before the request', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/widgets.git', async () => {
        let approveCalled = false;
        api.launchpadProvider.setFetchImplForTest((async (url: string, init?: RequestInit) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([
              {
                iid: 62,
                title: 'My own PR',
                web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/62',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          if (url.endsWith('/merge_requests/62/approve') && init?.method === 'POST') {
            approveCalled = true;
            return jsonResponse({});
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('My own PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        await api.launchpadProvider.submitReviewForTest('gitlab:acme/widgets#62', 'approve');
        assert.ok(!approveCalled, 'expected the approve endpoint to never be called for your own PR');
      }),
    ));

  test('renders a push/pull row for a repo even when the user declines to sign in — push/pull needs no forge credential at all', async () =>
    withLaunchpadEnabled(() =>
      // Bitbucket, not GitLab: every other test in this file authenticates against gitlab.com,
      // which would leave a stored PAT under that same host's secret-storage key — using a host
      // no other test touches guarantees this test actually exercises "no token stored yet".
      withOriginRemote('https://bitbucket.org/acme/widgets.git', async () => {
        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () => undefined) as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('class="repo-row"'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        const html = api.getLaunchpadHtml() ?? '';
        assert.match(html, /class="repo-row" data-key="bitbucket:acme\/widgets"/);
        assert.match(html, /Not signed in\./);
      }),
    ));

  test('syncRepoForTest: an unrecognized repo key is a silent no-op (no terminal created)', async () => {
    const before = vscode.window.terminals.length;
    api.launchpadProvider.syncRepoForTest('not-a-real-repo-key', 'pull');
    assert.equal(vscode.window.terminals.length, before);
  });

  test('gitLore.showPullRequest: opens the PR Details panel and renders that PR\'s real diff', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/details-widgets.git', async () => {
        api.launchpadProvider.setFetchImplForTest((async (url: string) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([
              {
                iid: 8,
                title: 'Details-worthy PR',
                web_url: 'https://gitlab.com/acme/details-widgets/-/merge_requests/8',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          if (url.includes('merge_requests/8/diffs')) {
            return jsonResponse([
              { old_path: 'src/real.ts', new_path: 'src/real.ts', diff: '@@ -1 +1,2 @@\n+a real diff line' },
            ]);
          }
          if (url.includes('merge_requests/8/discussions')) {
            return jsonResponse([]);
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Details-worthy PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'gitlab:acme/details-widgets#8');
        await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('a real diff line'));

        const html = api.getPullRequestDetailsHtml() ?? '';
        assert.match(html, /Details-worthy PR/);
        assert.match(html, /src\/real\.ts/);
        assert.match(html, /class="dc diff-add">\+a real diff line</);
      }),
    ));

  test('gitLore.showPullRequest: an unknown key shows a warning instead of throwing', async () => {
    const originalWarn = vscode.window.showWarningMessage;
    let warned: string | undefined;
    (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = ((message: string) => {
      warned = message;
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showWarningMessage;
    try {
      await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'github:nobody/nothing#999');
    } finally {
      vscode.window.showWarningMessage = originalWarn;
    }
    assert.match(warned ?? '', /isn't on the board/);
  });

  test('addCommentForTest: posts a comment against the PR currently loaded in the Details panel', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/comment-widgets.git', async () => {
        let capturedBody: string | undefined;
        api.launchpadProvider.setFetchImplForTest((async (url: string, init?: RequestInit) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([
              {
                iid: 9,
                title: 'Commentable PR',
                web_url: 'https://gitlab.com/acme/comment-widgets/-/merge_requests/9',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          if (url.includes('merge_requests/9/diffs')) {
            return jsonResponse([]);
          }
          if (url.includes('merge_requests/9/discussions')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/merge_requests/9/notes') && init?.method === 'POST') {
            capturedBody = JSON.parse(String(init.body)).body;
            return jsonResponse({});
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Commentable PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'gitlab:acme/comment-widgets#9');
        await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('Commentable PR'));

        await api.pullRequestDetailsProvider.addCommentForTest('Looks good to me');
        assert.equal(capturedBody, 'Looks good to me');
      }),
    ));

  test('resolveThreadForTest: resolves a conversation thread against the PR currently loaded in the Details panel', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://gitlab.com/acme/thread-widgets.git', async () => {
        let resolveCalled = false;
        api.launchpadProvider.setFetchImplForTest((async (url: string, init?: RequestInit) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ username: 'raj' });
          }
          if (url.includes('merge_requests?state=opened')) {
            return jsonResponse([
              {
                iid: 10,
                title: 'Thready PR',
                web_url: 'https://gitlab.com/acme/thread-widgets/-/merge_requests/10',
                author: { username: 'raj' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ]);
          }
          if (url.includes('merge_requests?state=merged') || url.includes('merge_requests?state=closed')) {
            return jsonResponse([]);
          }
          if (url.endsWith('/approvals')) {
            return jsonResponse({ approved: false, approved_by: [] });
          }
          if (url.includes('merge_requests/10/diffs')) {
            return jsonResponse([]);
          }
          // Checked before the broader discussions-list match below — the resolve PUT's URL
          // (".../discussions/d1?resolved=true") is also a substring match for
          // ".../discussions", so the specific check has to come first or it's unreachable.
          if (url.includes('merge_requests/10/discussions/d1') && init?.method === 'PUT') {
            resolveCalled = true;
            return jsonResponse({});
          }
          if (url.includes('merge_requests/10/discussions')) {
            return jsonResponse([
              { id: 'd1', notes: [{ body: 'Fix this', author: { username: 'amy' }, resolvable: true, resolved: false }] },
            ]);
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        const originalInput = vscode.window.showInputBox;
        (vscode.window as { showInputBox: typeof vscode.window.showInputBox }).showInputBox = (async () =>
          'fake-pat') as typeof vscode.window.showInputBox;
        try {
          await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
          await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Thready PR'));
        } finally {
          vscode.window.showInputBox = originalInput;
        }

        await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'gitlab:acme/thread-widgets#10');
        await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('Fix this'));

        await api.pullRequestDetailsProvider.resolveThreadForTest('d1');
        assert.ok(resolveCalled, 'expected the resolve-discussion endpoint to be called');
      }),
    ));
});
