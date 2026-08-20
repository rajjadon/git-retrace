# PR Details Panel Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Approve / Request Changes / Merge / Close / Reopen actions directly into the Pull Request Details panel, so acting on a PR no longer requires leaving the panel to find its card on the Launchpad board. Reuses `ForgeClient`'s existing per-host methods (`submitReview`, `mergePullRequest`, `closePullRequest`, `reopenPullRequest`) and Launchpad's exact confirm-dialog copy/UX — the only genuinely new capability is a `getPullRequest(repo, number)` method (added to the interface and all four clients) so the panel's header badges (built in the prior round) reflect the PR's real new state immediately after a successful action, instead of staying stale until a manual refresh.

**Architecture:** `PullRequestDetailsViewProvider` already holds the one `PullRequestSummary`/`ForgeClient` pair the panel is showing (`this.currentPr`/`this.currentClient`) — every new action method operates on those directly, no key-based lookup needed (unlike Launchpad, which juggles many cards at once). Each of the four `ForgeClient` implementations already has a private `enrich(repo, ...raw)` method that turns one raw host PR object into a `PullRequestSummary` (used today by `listOpenPullRequests`); `getPullRequest` is a thin new method per client that fetches one raw PR by number and reuses that same `enrich` call — no new normalization logic. The merge-strategy QuickPick (`STRATEGY_QUICK_PICK_LABELS` + `pickMergeStrategy`) currently lives as a private implementation detail of `LaunchpadViewProvider`; this plan extracts it into a shared `src/views/mergeStrategyPicker.ts` so both providers call the identical picker instead of one copying the other.

**Tech Stack:** TypeScript (strict), existing `ForgeClient` per-host REST clients, vanilla webview TS/CSS, `node:test` + `@vscode/test-electron`.

**Spec:** None — classified as a Bounded change (reuses existing flows/methods throughout), approved in-chat during this session's brainstorming pass. This plan exists because of the change's mechanical size (5 files just for the `getPullRequest` addition), not because it's architecturally novel.

## Global Constraints

- `ForgeClient` stays the only place each host's API is touched — no new HTTP client, no new auth handling.
- Confirm-dialog copy for Close/Reopen/Merge/Approve/Request Changes must match Launchpad's existing wording exactly (`LaunchpadViewProvider.ts`'s `closePullRequest`/`reopenPullRequest`/`mergePullRequest`/`submitReview` methods) — this is the same product surface area twice, and should read as the same product.
- Message type names from the PR Details webview to its provider (`closePr`, `reopenPr`, `mergePr`, `submitReview` with a `decision` field) match Launchpad's `render.ts` naming exactly, minus the `key`/`title` fields Launchpad needs for its multi-card lookup and this single-PR panel doesn't.
- No new runtime dependency.
- Every new `GitService`/`ForgeClient` method call must handle failure the same way this file's existing `resolveThread`/`addComment` methods already do: try/catch, `showErrorMessage` with the real reason, and a `*Failed` postMessage back to the webview so the clicked button re-enables itself.
- On success, refresh the header state via the new `getPullRequest` call (not a stale in-memory guess) before re-rendering, so badges never show wrong information after a successful action.

---

## File Structure

- Modify: `src/core/forge/ForgeClient.ts` — new `getPullRequest` method on the interface
- Modify: `src/core/forge/GitHubClient.ts`, `GitLabClient.ts`, `BitbucketClient.ts`, `AzureDevOpsClient.ts` — each implements `getPullRequest`
- Create: `src/views/mergeStrategyPicker.ts` — extracted shared QuickPick helper
- Modify: `src/views/Launchpad/LaunchpadViewProvider.ts` — use the extracted helper instead of its own private copy
- Modify: `src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts` — new action handlers + message routing + `*ForTest` methods
- Modify: `src/views/PullRequestDetails/render.ts` — new action buttons, gated on PR state
- Test: `test/unit/core/forge/{GitHubClient,GitLabClient,BitbucketClient,AzureDevOpsClient}.test.ts` — `getPullRequest` coverage
- Test: `test/unit/views/pullRequestDetails.render.test.ts` — button gating/wiring
- Test: `test/integration/launchpad.test.ts` — new `*ForTest` methods exercised end-to-end (existing file already covers `PullRequestDetailsViewProvider` this way)
- Modify: `CHANGELOG.md`

---

### Task 1: `getPullRequest` on `ForgeClient` + all four clients

**Files:**
- Modify: `src/core/forge/ForgeClient.ts`
- Modify: `src/core/forge/GitHubClient.ts`
- Modify: `src/core/forge/GitLabClient.ts`
- Modify: `src/core/forge/BitbucketClient.ts`
- Modify: `src/core/forge/AzureDevOpsClient.ts`
- Test: `test/unit/core/forge/GitHubClient.test.ts`, `GitLabClient.test.ts`, `BitbucketClient.test.ts`, `AzureDevOpsClient.test.ts`

**Interfaces:**
- Produces: `ForgeClient.getPullRequest(repo: ForgeRepoRef, number: number): Promise<PullRequestSummary>` — one new interface method, implemented identically in shape by all four clients (fetch one raw PR, reuse the client's own existing `enrich`).

- [ ] **Step 1: Add the interface method**

In `src/core/forge/ForgeClient.ts`, add after `getPullRequestDiff`:

```typescript
  /**
   * Re-fetches this PR's current summary — used after a mutating action taken from within the PR
   * Details panel (merge, close, reopen, submit a review) so its header badges reflect the real
   * new state immediately, instead of the stale `PullRequestSummary` the panel loaded with. Throws
   * with the real reason on failure, same contract as `closePullRequest`.
   */
  getPullRequest(repo: ForgeRepoRef, number: number): Promise<PullRequestSummary>;
```

- [ ] **Step 2: Write the failing test for GitHubClient**

In `test/unit/core/forge/GitHubClient.test.ts`, find the existing `listOpenPullRequests` test for the general shape/fixture pattern used, then add:

```typescript
test('getPullRequest: fetches one PR by number and enriches it the same way the list endpoint does', async () => {
  const client = new GitHubClient(
    BASE,
    'tok',
    fakeFetch({
      '/repos/acme/widgets/pulls/7': {
        number: 7,
        title: 'Single PR fetch',
        html_url: 'https://github.com/acme/widgets/pull/7',
        user: { login: 'raj' },
        draft: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        head: { sha: 'abc123' },
        requested_reviewers: [],
        mergeable_state: 'clean',
      },
      '/pulls/7/reviews?per_page=100': [],
      '/commits/abc123/check-runs?per_page=100': { check_runs: [] },
    }),
  );
  const result = await client.getPullRequest(REPO, 7);
  assert.equal(result.title, 'Single PR fetch');
  assert.equal(result.number, 7);
});
```

Verified against this file's real `BASE`/`REPO` constants (constructor is `new GitHubClient(BASE, token, fetchImpl)`, three args) and its existing `listOpenPullRequests: normalizes a plain open PR...` fixture's exact field names and route suffixes.

**Known, accepted inefficiency, not a bug to fix here:** `enrich()`'s `fetchMergeableState` unconditionally re-fetches `/repos/{identity}/pulls/{number}` internally — the exact same URL `getPullRequest` just fetched to get the base PR object — because the list endpoint (`listOpenPullRequests`' actual hot path) never includes `mergeable_state` at all, so `enrich` always has to ask for it separately regardless of caller. For `getPullRequest` specifically this means one harmless duplicate GET per call. Since `getPullRequest` only ever runs once per manual button click (never in a bulk refresh loop the way `listOpenPullRequests` does), building a second, `enrich()`-bypassing code path just to shave one small GET off a single click's latency is not worth the duplicated normalization logic it would require — reusing `enrich()` as-is is the correct, simple choice here.

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `client.getPullRequest` is not a function.

- [ ] **Step 4: Implement `GitHubClient.getPullRequest`**

In `src/core/forge/GitHubClient.ts`, add after `listOpenPullRequests`:

```typescript
  /** Same shape as a `listOpenPullRequests` item — reuses `enrich` directly, no separate normalization path. */
  async getPullRequest(repo: ForgeRepoRef, number: number): Promise<PullRequestSummary> {
    const res = await this.request(`/repos/${repo.identity}/pulls/${number}`);
    const pull = (await res.json()) as GitHubPull;
    return this.enrich(repo, pull);
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 6: Repeat Steps 2-5 for GitLabClient**

Test — verified against this file's real `BASE`/`REPO` constants and its existing `listOpenPullRequests: normalizes a plain open MR...` fixture shape (constructor is `new GitLabClient(BASE, token, fetchImpl)`, three args, not two):

```typescript
test('getPullRequest: fetches one merge request by iid and enriches it the same way the list endpoint does', async () => {
  const client = new GitLabClient(
    BASE,
    'tok',
    fakeFetch({
      'merge_requests/7': {
        iid: 7,
        title: 'Single MR fetch',
        web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/7',
        author: { username: 'raj' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      '/approvals': { approved: false, approved_by: [] },
    }),
  );
  const result = await client.getPullRequest(REPO, 7);
  assert.equal(result.title, 'Single MR fetch');
});
```

Implementation, added after `listOpenPullRequests` in `GitLabClient.ts`:

```typescript
  /** Same shape as a `listOpenPullRequests` item — reuses `enrich` directly, no separate normalization path. */
  async getPullRequest(repo: ForgeRepoRef, number: number): Promise<PullRequestSummary> {
    const projectPath = encodeURIComponent(repo.identity);
    const res = await this.request(`/projects/${projectPath}/merge_requests/${number}`);
    const mr = (await res.json()) as GitLabMergeRequest;
    return this.enrich(repo, projectPath, mr);
  }
```

- [ ] **Step 7: Repeat Steps 2-5 for BitbucketClient**

Test — verified against this file's real `BASE`/`REPO` constants and its existing `listOpenPullRequests: normalizes a plain open PR...` fixture shape (constructor is `new BitbucketClient(BASE, token, fetchImpl)`; author is `{ username }`, not a display name/uuid pair):

```typescript
test('getPullRequest: fetches one PR by id and enriches it the same way the list endpoint does', async () => {
  const client = new BitbucketClient(
    BASE,
    'tok',
    fakeFetch({
      'pullrequests/7': {
        id: 7,
        title: 'Single PR fetch',
        links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/7' } },
        author: { username: 'raj' },
        created_on: '2024-01-01T00:00:00Z',
        updated_on: '2024-01-01T00:00:00Z',
        source: { commit: { hash: 'abc123' } },
      },
      '/statuses': { values: [] },
    }),
  );
  const result = await client.getPullRequest(REPO, 7);
  assert.equal(result.title, 'Single PR fetch');
});
```

Implementation, added after `listOpenPullRequests` in `BitbucketClient.ts`:

```typescript
  /** Same shape as a `listOpenPullRequests` item — reuses `enrich` directly, no separate normalization path. */
  async getPullRequest(repo: ForgeRepoRef, number: number): Promise<PullRequestSummary> {
    const res = await this.request(`/repositories/${repo.identity}/pullrequests/${number}`);
    const pr = (await res.json()) as BitbucketPullRequest;
    return this.enrich(repo, pr);
  }
```

- [ ] **Step 8: Repeat Steps 2-5 for AzureDevOpsClient**

Test (adapt to this file's actual established Azure DevOps PR fixture shape — reuse the same `IDENTITY`/`REPO` constants the rest of this test file already defines):

```typescript
test('getPullRequest: fetches one PR by id and enriches it the same way the list endpoint does', async () => {
  const client = new AzureDevOpsClient(IDENTITY, 'pat', 'pat', (async (url: string) => {
    if (url.includes('/pullrequests/7?api-version')) {
      return jsonResponse({
        pullRequestId: 7,
        title: 'Single PR fetch',
        createdBy: { uniqueName: 'raj@acme.com' },
        creationDate: '2024-01-01T00:00:00Z',
      });
    }
    throw new Error(`unmocked: ${url}`);
  }) as unknown as typeof fetch);
  const result = await client.getPullRequest(REPO, 7);
  assert.equal(result.title, 'Single PR fetch');
});
```

Implementation, added after `listOpenPullRequests` in `AzureDevOpsClient.ts` (reuses the exact `id`/`base` construction `closePullRequest`/`reopenPullRequest` already build):

```typescript
  /** Same shape as a `listOpenPullRequests` item — reuses `enrich` directly, no separate normalization path. */
  async getPullRequest(repo: ForgeRepoRef, number: number): Promise<PullRequestSummary> {
    const id = splitAzureDevOpsIdentity(repo.identity);
    if (!id) {
      throw new Error('could not resolve this repo\'s Azure DevOps organization/project/repository identity');
    }
    const base = `https://dev.azure.com/${id.organization}/${id.project}/_apis/git/repositories/${id.repository}`;
    const res = await this.request(`${base}/pullrequests/${number}?api-version=7.1`);
    const pr = (await res.json()) as AzureDevOpsPullRequest;
    return this.enrich(repo, id, base, pr);
  }
```

- [ ] **Step 9: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, all four new tests plus every existing test green.

- [ ] **Step 10: Commit**

```bash
git add src/core/forge/ForgeClient.ts src/core/forge/GitHubClient.ts src/core/forge/GitLabClient.ts src/core/forge/BitbucketClient.ts src/core/forge/AzureDevOpsClient.ts test/unit/core/forge/GitHubClient.test.ts test/unit/core/forge/GitLabClient.test.ts test/unit/core/forge/BitbucketClient.test.ts test/unit/core/forge/AzureDevOpsClient.test.ts
git commit -m "feat(forge): add getPullRequest for refreshing a single PR's state"
```

---

### Task 2: Extract the merge-strategy QuickPick into a shared helper

**Files:**
- Create: `src/views/mergeStrategyPicker.ts`
- Modify: `src/views/Launchpad/LaunchpadViewProvider.ts`

**Interfaces:**
- Produces: `pickMergeStrategy(pr: PullRequestSummary): Promise<MergeStrategy | undefined>` (moved from `LaunchpadViewProvider.ts`, now exported)
- Consumed by: `LaunchpadViewProvider.mergePullRequest` (existing call site, updated to import instead of using its own private copy) and, in Task 4, `PullRequestDetailsViewProvider.mergePullRequest` (new call site)

This is a pure refactor — no behavior change. No new test needed; Launchpad's own existing merge tests (`mergePullRequestForTest` et al. in `test/integration/launchpad.test.ts`) already cover this code path and must stay green.

- [ ] **Step 1: Create the shared file**

Create `src/views/mergeStrategyPicker.ts`:

```typescript
import * as vscode from 'vscode';
import { MERGE_STRATEGIES_BY_HOST, type MergeStrategy, type PullRequestSummary } from '../core/forge/types';

/** Labels/descriptions for the merge-strategy QuickPick, one per `MergeStrategy` — filtered per host via `MERGE_STRATEGIES_BY_HOST` before it's ever shown, so a host never offers a strategy it can't actually perform. Shared by Launchpad's card Merge action and Pull Request Details' Merge action — the same product surface twice, so the same picker. */
const STRATEGY_QUICK_PICK_LABELS: Record<MergeStrategy, { label: string; description: string }> = {
  merge: { label: 'Merge', description: 'Create a merge commit' },
  squash: { label: 'Squash and merge', description: 'Combine all commits into one' },
  rebase: { label: 'Rebase and merge', description: 'Replay commits onto the base — no merge commit' },
};

export async function pickMergeStrategy(pr: PullRequestSummary): Promise<MergeStrategy | undefined> {
  const items = MERGE_STRATEGIES_BY_HOST[pr.repo.host].map((strategy) => ({ ...STRATEGY_QUICK_PICK_LABELS[strategy], strategy }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'How should this pull request be merged?' });
  return picked?.strategy;
}
```

- [ ] **Step 2: Update `LaunchpadViewProvider.ts` to use it**

Remove the private `STRATEGY_QUICK_PICK_LABELS` const (lines ~27-32) and the private `pickMergeStrategy` method (lines ~530-534) from `LaunchpadViewProvider.ts`. Remove `MergeStrategy` from its import from `../../core/forge/types` if it's no longer referenced elsewhere in the file (check first — `mergePullRequestForTest`'s signature also uses `MergeStrategy`, so it likely stays). Add:

```typescript
import { pickMergeStrategy } from '../mergeStrategyPicker';
```

And update the one call site inside `mergePullRequest`:

```typescript
    const strategy = await pickMergeStrategy(pr);
```

(was `await this.pickMergeStrategy(pr)`)

- [ ] **Step 3: Run Launchpad's existing tests to confirm no regression**

Run: `npm run compile && npm run test:unit`
Expected: PASS, clean compile — this step only moves code, no behavior change.

- [ ] **Step 4: Commit**

```bash
git add src/views/mergeStrategyPicker.ts src/views/Launchpad/LaunchpadViewProvider.ts
git commit -m "refactor: extract the merge-strategy QuickPick into a shared helper"
```

---

### Task 3: Wire the action handlers into `PullRequestDetailsViewProvider`

**Files:**
- Modify: `src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts`

**Interfaces:**
- Produces: `closePullRequestForTest(): Promise<void>`, `reopenPullRequestForTest(): Promise<void>`, `mergePullRequestForTest(strategy: MergeStrategy, deleteSourceBranch: boolean): Promise<void>`, `submitReviewForTest(decision: ReviewSubmission): Promise<void>` — test-only introspection seams matching this file's own existing `resolveThreadForTest`/`addCommentForTest` convention exactly.
- Consumes: `pickMergeStrategy` from Task 2, `ForgeClient.getPullRequest` from Task 1.

- [ ] **Step 1: Add the imports**

In `src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts`, extend the existing type import from `../../core/forge/types`:

```typescript
import type { ConversationThread, MergeStrategy, PullRequestSummary, ReviewSubmission } from '../../core/forge/types';
```

Add:

```typescript
import { pickMergeStrategy } from '../mergeStrategyPicker';
```

- [ ] **Step 2: Add the four action methods**

Add these after `resolveThread`/`resolveThreadForTest` (i.e. right before `private async addComment`):

```typescript
  private async closePullRequest(pr: PullRequestSummary, client: ForgeClient): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Close "${pr.title}"? This closes it on ${pr.repo.label} without merging.`,
      { modal: true },
      'Close PR',
    );
    if (confirmed !== 'Close PR') {
      return;
    }
    try {
      await client.closePullRequest(pr.repo, pr.number);
      const refreshed = await client.getPullRequest(pr.repo, pr.number);
      await this.load(refreshed, client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PR Details failed to close PR #${pr.number}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't close the PR — ${message}`);
      void this.view?.webview.postMessage({ type: 'actionFailed' });
    }
  }

  /** Test-only introspection seam — a webview button click (and the real confirmation modal it triggers) can't be driven from an integration test, so this calls the close flow directly, skipping only the modal. */
  async closePullRequestForTest(): Promise<void> {
    if (!this.currentPr || !this.currentClient) {
      return;
    }
    await this.currentClient.closePullRequest(this.currentPr.repo, this.currentPr.number);
    const refreshed = await this.currentClient.getPullRequest(this.currentPr.repo, this.currentPr.number);
    await this.load(refreshed, this.currentClient);
  }

  private async reopenPullRequest(pr: PullRequestSummary, client: ForgeClient): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(`Reopen "${pr.title}" on ${pr.repo.label}?`, { modal: true }, 'Reopen PR');
    if (confirmed !== 'Reopen PR') {
      return;
    }
    try {
      await client.reopenPullRequest(pr.repo, pr.number);
      const refreshed = await client.getPullRequest(pr.repo, pr.number);
      await this.load(refreshed, client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PR Details failed to reopen PR #${pr.number}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't reopen the PR — ${message}`);
      void this.view?.webview.postMessage({ type: 'actionFailed' });
    }
  }

  /** Test-only introspection seam — a webview button click (and the real confirmation modal it triggers) can't be driven from an integration test, so this calls the reopen flow directly, skipping only the modal. */
  async reopenPullRequestForTest(): Promise<void> {
    if (!this.currentPr || !this.currentClient) {
      return;
    }
    await this.currentClient.reopenPullRequest(this.currentPr.repo, this.currentPr.number);
    const refreshed = await this.currentClient.getPullRequest(this.currentPr.repo, this.currentPr.number);
    await this.load(refreshed, this.currentClient);
  }

  /** A QuickPick for the strategy (filtered to what this PR's host actually supports), then one modal confirm with two buttons — "Merge" and "Merge & Delete Branch" — matching Launchpad's card Merge action exactly. */
  private async mergePullRequest(pr: PullRequestSummary, client: ForgeClient): Promise<void> {
    const strategy = await pickMergeStrategy(pr);
    if (!strategy) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Merge "${pr.title}" on ${pr.repo.label}? This can't be undone.`,
      { modal: true },
      'Merge',
      'Merge & Delete Branch',
    );
    if (confirmed !== 'Merge' && confirmed !== 'Merge & Delete Branch') {
      return;
    }
    try {
      await client.mergePullRequest(pr.repo, pr.number, { strategy, deleteSourceBranch: confirmed === 'Merge & Delete Branch' });
      const refreshed = await client.getPullRequest(pr.repo, pr.number);
      await this.load(refreshed, client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PR Details failed to merge PR #${pr.number}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't merge the PR — ${message}`);
      void this.view?.webview.postMessage({ type: 'actionFailed' });
    }
  }

  /** Test-only introspection seam — the merge QuickPick and confirmation modal can't be driven from an integration test, so this calls the merge flow directly with a fixed strategy/delete choice, skipping both prompts. */
  async mergePullRequestForTest(strategy: MergeStrategy, deleteSourceBranch: boolean): Promise<void> {
    if (!this.currentPr || !this.currentClient) {
      return;
    }
    await this.currentClient.mergePullRequest(this.currentPr.repo, this.currentPr.number, { strategy, deleteSourceBranch });
    const refreshed = await this.currentClient.getPullRequest(this.currentPr.repo, this.currentPr.number);
    await this.load(refreshed, this.currentClient);
  }

  /** Every host we support rejects a review from the PR's own author one way or another — checked live via `getAuthenticatedLogin` rather than a cached map, since this panel only ever shows one PR at a time (unlike Launchpad's board, which caches a login per repo across many cards to avoid re-checking on every render). */
  private async submitReview(pr: PullRequestSummary, client: ForgeClient, decision: ReviewSubmission): Promise<void> {
    const login = await client.getAuthenticatedLogin();
    if (login && pr.authorLogin.toLowerCase() === login.toLowerCase()) {
      void vscode.window.showWarningMessage("GitLore: you can't review your own pull request.");
      return;
    }
    const verb = decision === 'approve' ? 'Approve' : 'Request changes on';
    const confirmed = await vscode.window.showWarningMessage(`${verb} "${pr.title}" on ${pr.repo.label}?`, { modal: true }, verb);
    if (confirmed !== verb) {
      return;
    }
    try {
      await client.submitReview(pr.repo, pr.number, decision);
      const refreshed = await client.getPullRequest(pr.repo, pr.number);
      await this.load(refreshed, client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PR Details failed to submit a review for PR #${pr.number}`, err);
      void vscode.window.showErrorMessage(`GitLore: couldn't submit that review — ${message}`);
      void this.view?.webview.postMessage({ type: 'actionFailed' });
    }
  }

  /** Test-only introspection seam — a webview button click (and the real confirmation modal it triggers) can't be driven from an integration test, so this calls the review flow directly, skipping only the modal and the self-review check. */
  async submitReviewForTest(decision: ReviewSubmission): Promise<void> {
    if (!this.currentPr || !this.currentClient) {
      return;
    }
    await this.currentClient.submitReview(this.currentPr.repo, this.currentPr.number, decision);
    const refreshed = await this.currentClient.getPullRequest(this.currentPr.repo, this.currentPr.number);
    await this.load(refreshed, this.currentClient);
  }
```

- [ ] **Step 3: Route the new message types in `handleMessage`**

In `handleMessage`, extend the destructured fields and add four new branches. Replace:

```typescript
    const { type, body, threadId } = message as { type?: unknown; body?: unknown; threadId?: unknown };
```

with:

```typescript
    const { type, body, threadId, decision } = message as { type?: unknown; body?: unknown; threadId?: unknown; decision?: unknown };
```

Then add, right before the existing `if (type === 'refresh' && ...)` block:

```typescript
    if (type === 'closePr' && this.currentPr && this.currentClient) {
      await this.closePullRequest(this.currentPr, this.currentClient);
      return;
    }
    if (type === 'reopenPr' && this.currentPr && this.currentClient) {
      await this.reopenPullRequest(this.currentPr, this.currentClient);
      return;
    }
    if (type === 'mergePr' && this.currentPr && this.currentClient) {
      await this.mergePullRequest(this.currentPr, this.currentClient);
      return;
    }
    if (type === 'submitReview' && (decision === 'approve' || decision === 'requestChanges') && this.currentPr && this.currentClient) {
      await this.submitReview(this.currentPr, this.currentClient, decision);
      return;
    }
```

- [ ] **Step 4: Run the render tests to confirm nothing broke, then compile**

Run: `npm run compile`
Expected: clean — this task doesn't yet add the buttons that send these messages (Task 4 does), so nothing new is reachable from the webview yet; this step only confirms the provider code itself type-checks.

- [ ] **Step 5: Commit**

```bash
git add src/views/PullRequestDetails/PullRequestDetailsViewProvider.ts
git commit -m "feat(pr-details): wire close/reopen/merge/submitReview action handlers"
```

---

### Task 4: Add the action buttons to `render.ts`

**Files:**
- Modify: `src/views/PullRequestDetails/render.ts`
- Test: `test/unit/views/pullRequestDetails.render.test.ts`

**Interfaces:** None new — pure markup/script addition to the existing `renderPullRequestDetailsHtml`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/views/pullRequestDetails.render.test.ts`:

```typescript
test('renderPullRequestDetailsHtml: an open PR shows Approve, Request Changes, and Close buttons', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.match(html, /id="approve-pr"/);
  assert.match(html, /id="request-changes-pr"/);
  assert.match(html, /id="close-pr"/);
});

test('renderPullRequestDetailsHtml: a merged or closed PR shows none of Approve/Request Changes/Close', () => {
  const html = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: true }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!html.includes('id="approve-pr"'));
  assert.ok(!html.includes('id="request-changes-pr"'));
  assert.ok(!html.includes('id="close-pr"'));
});

test('renderPullRequestDetailsHtml: a closed-without-merging PR shows a Reopen button; a merged one does not', () => {
  const closed = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: false }), files, diff, threads: [], now },
    opts,
  );
  assert.match(closed, /id="reopen-pr"/);
  const merged = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: true }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!merged.includes('id="reopen-pr"'));
});

test('renderPullRequestDetailsHtml: an open PR shows no Reopen button', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.ok(!html.includes('id="reopen-pr"'));
});

test('renderPullRequestDetailsHtml: shows Merge only when approved, checks aren\'t pending, and there are no conflicts — matching Launchpad\'s own "ready to merge" rule', () => {
  const ready = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'approved', checkStatus: 'passing', hasConflicts: false }), files, diff, threads: [], now },
    opts,
  );
  assert.match(ready, /id="merge-pr"/);

  const notApproved = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'reviewRequired', checkStatus: 'passing', hasConflicts: false }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!notApproved.includes('id="merge-pr"'));

  const pendingChecks = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'approved', checkStatus: 'pending', hasConflicts: false }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!pendingChecks.includes('id="merge-pr"'));

  const conflicted = renderPullRequestDetailsHtml(
    { pr: pr({ reviewDecision: 'approved', checkStatus: 'passing', hasConflicts: true }), files, diff, threads: [], now },
    opts,
  );
  assert.ok(!conflicted.includes('id="merge-pr"'));
});

test('renderPullRequestDetailsHtml: Approve posts submitReview with decision "approve"; Request Changes posts "requestChanges"', () => {
  const html = renderPullRequestDetailsHtml({ pr: pr(), files, diff, threads: [], now }, opts);
  assert.match(html, /getElementById\('approve-pr'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'submitReview', decision: 'approve' \}\);/);
  assert.match(html, /getElementById\('request-changes-pr'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'submitReview', decision: 'requestChanges' \}\);/);
});

test('renderPullRequestDetailsHtml: Close/Reopen/Merge buttons post closePr/reopenPr/mergePr', () => {
  const open = renderPullRequestDetailsHtml({ pr: pr({ reviewDecision: 'approved', checkStatus: 'passing' }), files, diff, threads: [], now }, opts);
  assert.match(open, /getElementById\('close-pr'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'closePr' \}\);/);
  assert.match(open, /getElementById\('merge-pr'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'mergePr' \}\);/);

  const closed = renderPullRequestDetailsHtml(
    { pr: pr({ closedAt: '2024-02-05T00:00:00Z', merged: false }), files, diff, threads: [], now },
    opts,
  );
  assert.match(closed, /getElementById\('reopen-pr'\)\.addEventListener\('click', \(\) => \{\s*vscode\.postMessage\(\{ type: 'reopenPr' \}\);/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — none of `approve-pr`/`request-changes-pr`/`close-pr`/`reopen-pr`/`merge-pr` exist yet.

- [ ] **Step 3: Add the icon imports**

In `src/views/PullRequestDetails/render.ts`, extend the icons import to add the four action icons already defined in `icons.ts` (used today by Launchpad's cards for the identical actions):

```typescript
import {
  AI_ICON,
  APPROVE_ICON,
  AUTHOR_ICON,
  CLOSE_ICON,
  EXTERNAL_ICON,
  FILES_ICON,
  MERGE_ICON,
  MESSAGE_ICON,
  REFRESH_ICON,
  REOPEN_ICON,
  REQUEST_CHANGES_ICON,
  SEARCH_ICON,
  WRAP_ICON,
} from '../icons';
```

- [ ] **Step 4: Add a `renderActionButtons` helper**

Add this function right before `renderStatusBadges` (same file):

```typescript
/**
 * Merge only appears when the PR is already approved, checks aren't pending, and there are no
 * conflicts — the exact same "ready to merge" rule `categorize.ts`'s `bucketFor` uses for
 * Launchpad's own board, so clicking it here never bounces off a host-side rejection the badges
 * above already would have predicted. Approve/Request Changes/Close show on any open PR (matching
 * Launchpad's own card, which doesn't special-case drafts either); Reopen only on a closed (not
 * merged) one — no host we support lets a merge be undone this way.
 */
function renderActionButtons(pr: PullRequestSummary): string {
  if (pr.closedAt) {
    return pr.merged
      ? ''
      : `<button class="icon-btn" id="reopen-pr" type="button" title="Reopen PR" aria-label="Reopen this pull request">${REOPEN_ICON}</button>`;
  }
  const canMerge = pr.reviewDecision === 'approved' && pr.checkStatus !== 'pending' && !pr.hasConflicts;
  const mergeButton = canMerge
    ? `<button class="icon-btn" id="merge-pr" type="button" title="Merge PR" aria-label="Merge this pull request">${MERGE_ICON}</button>`
    : '';
  return `<button class="icon-btn" id="approve-pr" type="button" title="Approve PR" aria-label="Approve this pull request">${APPROVE_ICON}</button>
<button class="icon-btn" id="request-changes-pr" type="button" title="Request changes on PR" aria-label="Request changes on this pull request">${REQUEST_CHANGES_ICON}</button>
${mergeButton}<button class="icon-btn" id="close-pr" type="button" title="Close PR" aria-label="Close this pull request">${CLOSE_ICON}</button>`;
}
```

- [ ] **Step 5: Wire it into the action bar**

Find the existing `.actions` div:

```html
<div class="actions">
<button class="btn" id="open-remote" type="button" title="${escapeHtml(pr.url)}">${EXTERNAL_ICON}Open on ${escapeHtml(pr.repo.host)}</button>
<button class="icon-btn" id="refresh-pr" type="button" title="Refresh — picks up changes made elsewhere (e.g. a review submitted from Launchpad)" aria-label="Refresh this pull request's details">${REFRESH_ICON}</button>
<button class="btn btn-accent" id="explain-pr" type="button" title="Explain this PR with AI">${AI_ICON}Explain</button>
<button class="btn" id="draft-review" type="button" title="Draft a review comment with AI">${AI_ICON}Draft Review</button>
</div>
```

Replace with (new action buttons inserted between refresh and the AI actions, matching Launchpad's card ordering of state-changing actions before the informational ones):

```html
<div class="actions">
<button class="btn" id="open-remote" type="button" title="${escapeHtml(pr.url)}">${EXTERNAL_ICON}Open on ${escapeHtml(pr.repo.host)}</button>
<button class="icon-btn" id="refresh-pr" type="button" title="Refresh — picks up changes made elsewhere (e.g. a review submitted from Launchpad)" aria-label="Refresh this pull request's details">${REFRESH_ICON}</button>
${renderActionButtons(pr)}
<button class="btn btn-accent" id="explain-pr" type="button" title="Explain this PR with AI">${AI_ICON}Explain</button>
<button class="btn" id="draft-review" type="button" title="Draft a review comment with AI">${AI_ICON}Draft Review</button>
</div>
```

- [ ] **Step 6: Wire the click handlers in the `<script>` block**

Right after the existing `refresh-pr` listener:

```javascript
document.getElementById('refresh-pr').addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});
```

add:

```javascript
document.getElementById('approve-pr')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'submitReview', decision: 'approve' });
});
document.getElementById('request-changes-pr')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'submitReview', decision: 'requestChanges' });
});
document.getElementById('merge-pr')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'mergePr' });
});
document.getElementById('close-pr')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'closePr' });
});
document.getElementById('reopen-pr')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'reopenPr' });
});
```

(Optional-chained `?.` throughout, since exactly one of `close-pr`/`reopen-pr`/`merge-pr` may be absent depending on PR state — unlike `refresh-pr`, which always exists.)

- [ ] **Step 7: Run to verify the render tests pass**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/views/PullRequestDetails/render.ts test/unit/views/pullRequestDetails.render.test.ts
git commit -m "feat(pr-details): add Approve/Request Changes/Merge/Close/Reopen buttons"
```

---

### Task 5: End-to-end integration coverage

**Files:**
- Modify: `test/integration/launchpad.test.ts`

**Interfaces:** None new — exercises Task 3's `*ForTest` methods through the same real-extension-host pattern this file already uses for `addCommentForTest`/`resolveThreadForTest`.

- [ ] **Step 1: Read the exact fixture pattern before writing**

Read `test/integration/launchpad.test.ts`'s existing `addCommentForTest` test block (search for `'addCommentForTest:'`) in full — it shows the exact sequence: mock `setFetchImplForTest` on `api.launchpadProvider`, open Launchpad, wait for the PR to appear, run `showPullRequest`, wait for PR Details to load, then call the target `*ForTest` method and assert on a captured request.

- [ ] **Step 2: Add one integration test per new action, one host each (spread across hosts already used elsewhere in this file for variety, not all on the same one)**

Add after the existing `resolveThreadForTest` test block:

```typescript
  test('closePullRequestForTest: closes the PR currently loaded in the Details panel', async () =>
    withLaunchpadEnabled(() =>
      withOriginRemote('https://github.com/acme/closeable-widgets.git', async () => {
        let closeCalled = false;
        api.launchpadProvider.setFetchImplForTest((async (url: string, init?: RequestInit) => {
          if (url.endsWith('/user')) {
            return jsonResponse({ login: 'raj' });
          }
          if (url.includes('/pulls?state=open')) {
            return jsonResponse([
              {
                number: 11,
                title: 'Closeable PR',
                html_url: 'https://github.com/acme/closeable-widgets/pull/11',
                user: { login: 'raj' },
                draft: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                head: { sha: 'abc123' },
                requested_reviewers: [],
                mergeable_state: 'clean',
              },
            ]);
          }
          if (url.includes('/pulls?state=closed')) {
            return jsonResponse([]);
          }
          if (url.includes('/pulls/11/reviews')) {
            return jsonResponse([]);
          }
          if (url.includes('/commits/abc123/check-runs')) {
            return jsonResponse({ check_runs: [] });
          }
          if (url.endsWith('/pulls/11') && (!init || init.method === undefined)) {
            return jsonResponse({
              number: 11,
              title: 'Closeable PR',
              html_url: 'https://github.com/acme/closeable-widgets/pull/11',
              user: { login: 'raj' },
              draft: false,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
              head: { sha: 'abc123' },
              requested_reviewers: [],
              mergeable_state: 'clean',
            });
          }
          if (url.endsWith('/pulls/11') && init?.method === 'PATCH') {
            closeCalled = true;
            return jsonResponse({});
          }
          throw new Error(`unmocked request in test: ${url}`);
        }) as unknown as typeof fetch);

        await vscode.commands.executeCommand(COMMANDS.openLaunchpad);
        await waitFor(() => (api.getLaunchpadHtml() ?? '').includes('Closeable PR'));

        await vscode.commands.executeCommand(COMMANDS.showPullRequest, 'github:acme/closeable-widgets#11');
        await waitFor(() => (api.getPullRequestDetailsHtml() ?? '').includes('Closeable PR'));

        await api.pullRequestDetailsProvider.closePullRequestForTest();
        assert.ok(closeCalled, 'expected a PATCH to /pulls/11');
      }),
    ));
```

Match the exact mocked field names/URL patterns to what this file's neighboring GitHub-flavored tests already establish (read one in full first — e.g. the merge/close tests already exercised against Launchpad cards for GitHub, since those already call `client.closePullRequest`/`mergePullRequest` against the identical real endpoint shape) rather than inventing new ones; the exact PATCH body GitHub's `closePullRequest` sends is already established in `GitHubClient.ts` and its own unit test — this integration test only needs to detect that the call happened, not re-verify its body (that's `GitHubClient.test.ts`'s job).

Add equivalent tests for `reopenPullRequestForTest`, `mergePullRequestForTest`, and `submitReviewForTest` (one `approve` case is enough — `requestChanges` is already covered at the `ForgeClient` unit level), spreading across at least 2 different hosts total across all four new tests so this doesn't become a GitHub-only regression net — reuse whichever host-specific fixture patterns (GitLab/Bitbucket/Azure DevOps) this file's existing merge/close/reopen tests (against Launchpad cards, already in this file) already establish, rather than inventing new host fixtures from scratch.

- [ ] **Step 3: Run the integration suite**

Run: `npm run compile && npm run test:integration`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/integration/launchpad.test.ts
git commit -m "test(pr-details): integration coverage for close/reopen/merge/submitReview actions"
```

---

### Task 6: Changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the entry**

Under `## [Unreleased]` → `### Added`, after the status-badges entry from the prior round:

```markdown
- **Pull Request Details: act without leaving the panel** — Approve, Request Changes, Merge, Close, and Reopen are now buttons in the PR Details panel itself, the same actions Launchpad's board already offered per card. Merge only appears once a PR is actually ready (approved, checks not pending, no conflicts) — the same rule the board's own "Ready to Merge" column already uses, so it never bounces off a host-side rejection. The panel's status badges refresh immediately after a successful action instead of waiting for a manual Refresh.
```

- [ ] **Step 2: Full verification**

Run: `npm run lint`, `npm run compile`, `npm run test:unit`, `npm run test:integration`.
Expected: all clean/passing.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for PR Details panel actions"
```

---

## Verification (whole plan)

- [ ] `npm run lint` clean
- [ ] `npm run compile` clean
- [ ] `npm run test:unit` — all pass, including the new `getPullRequest` tests (×4 clients) and the new render-gating tests
- [ ] `npm run test:integration` — all pass, including the new close/reopen/merge/submitReview end-to-end tests
- [ ] Manual F5 check: open a real PR in Launchpad, drill into Details, confirm Approve/Request Changes/Close appear on an open PR, Merge appears only once genuinely ready, Reopen appears only on a closed-not-merged PR, and each action's confirm dialog matches Launchpad's own card wording exactly.
