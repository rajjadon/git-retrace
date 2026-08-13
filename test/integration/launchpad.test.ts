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
});
