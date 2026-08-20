# Git Feature Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the git-operation gaps identified in `docs/roadmap-audit-2026-08-19.md` Track 1 — Sidebar Explorer read/write parity (delete/rename branch, delete tag, worktree add/remove, create stash), `.git-blame-ignore-revs` blame support, and a standalone Fetch button.

**Architecture:** Every mutating operation is a new `GitService` method following the file's established shape exactly (`getRepoRoot` guard → `gitFor(repoRoot)` → build `args` → `git.raw(args)` in a try/catch that rethrows `GitCommandError`). Every Explorer action is a new command handler in `src/commands/explorerCommands.ts` following the existing `ExplorerLeafNode`-narrowing + confirm-dialog + `errorMessage()` pattern, wired into `RepoExplorerProvider`'s existing `view/item/context` menu via `package.json`. `GitService` remains the sole `simple-git` import site (CLAUDE.md §10) — no new file imports `simple-git`.

**Tech Stack:** TypeScript (strict), `simple-git` (via `GitService.raw`), VS Code TreeView/QuickPick/InputBox APIs, `node:test` + `node:assert/strict`, `@vscode/test-electron` integration tests.

**Spec:** `docs/roadmap-audit-2026-08-19.md` (Track 1, and Top-5 items #1 and #2)

## Global Constraints

- All git access goes through `GitService` — nothing else imports `simple-git` (CLAUDE.md §10).
- No `vscode` imports inside `core/` (CLAUDE.md §5 dependency rule).
- No magic strings — every command ID and config key goes through `src/constants.ts` (CLAUDE.md §9).
- Every `vscode.Disposable` (command registration) goes into `context.subscriptions` (CLAUDE.md §9).
- Destructive actions confirm first via `vscode.window.showWarningMessage(..., { modal: true }, '<Action>')`, matching the existing `dropStash`/`mergeBranchFromExplorer` pattern.
- A feature is not done without: a test, a `README.md` feature-list line, and a `CHANGELOG.md` entry under `## [Unreleased]` (CLAUDE.md §16).
- Command titles follow the existing `GitLore: <Verb> <Noun>` convention.
- No new runtime dependency — everything here is `simple-git` raw args + built-in VS Code APIs.

---

## File Structure

- Modify: `src/core/git/GitService.ts` — new mutation/query methods (Tasks 1–6)
- Modify: `src/core/git/types.ts` — new `ReflogEntry` type (Task 5)
- Modify: `src/core/git/parsers.ts` — new `parseReflog` (Task 5)
- Modify: `src/core/explorer/buildExplorerTree.ts` — section `contextValue` support (Task 3, Task 4)
- Modify: `src/providers/RepoExplorerProvider.ts` — section `contextValue`, new leaf actions surfaced via existing `contextValue`s
- Modify: `src/commands/explorerCommands.ts` — new command handlers (Tasks 1–5)
- Modify: `src/constants.ts` — new command IDs
- Modify: `src/extension.ts` — register new command handlers
- Modify: `package.json` — new `commands` entries + `view/item/context` menu entries
- Modify: `test/fixtures/build-fixture-repo.ts` — no changes needed; existing `ExplorerFixtureManifest` (`otherBranch`, `tagName`) already covers Tasks 1–2's fixtures
- Modify: `test/integration/sidebarExplorer.test.ts` — new command tests (Tasks 1–5)
- Create: `test/unit/core/git/parsers.reflog.test.ts` (Task 5)
- Modify: `src/core/git/GitService.ts` (`blameFile`) — Task 6
- Modify: `test/integration/*` (blame fixture) — Task 6
- Modify: `src/views/CommitGraph/CommitGraphViewProvider.ts`, `src/views/CommitGraph/render.ts`, `src/views/Launchpad/LaunchpadViewProvider.ts`, `src/views/Launchpad/render.ts` — Task 7
- Modify: `README.md`, `CHANGELOG.md` — every task

---

### Task 1: Delete and rename a local branch

**Files:**
- Modify: `src/core/git/GitService.ts` (add methods after `createBranch`, ~line 663)
- Modify: `src/constants.ts` (`COMMANDS`)
- Modify: `src/commands/explorerCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (`commands`, `menus.view/item/context`)
- Test: `test/integration/sidebarExplorer.test.ts`

**Interfaces:**
- Produces: `GitService.deleteBranch(filePath: string, name: string, force: boolean): Promise<void>`
- Produces: `GitService.renameBranch(filePath: string, oldName: string, newName: string): Promise<void>`
- Produces: `COMMANDS.deleteBranchFromExplorer`, `COMMANDS.renameBranchFromExplorer` (both `string`)
- Produces: `handleDeleteBranchCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable`
- Produces: `handleRenameBranchCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable`

- [ ] **Step 1: Write the failing integration test**

Append to `test/integration/sidebarExplorer.test.ts`, right before the closing `});` of the `suite(...)` block:

```typescript
  test('gitLore.renameBranchFromExplorer renames a local branch after prompting for the new name', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => 'renamed-branch';
    try {
      await vscode.commands.executeCommand(COMMANDS.renameBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(branches.some((b) => b.name === 'renamed-branch'), 'renamed branch not found');
    assert.ok(!branches.some((b) => b.name === fixture.otherBranch), 'old branch name still present');
  });

  test('gitLore.deleteBranchFromExplorer requires confirmation and then deletes a local branch', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Delete';
    try {
      await vscode.commands.executeCommand(COMMANDS.deleteBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(!branches.some((b) => b.name === fixture.otherBranch), 'branch was not deleted');
  });

  test('gitLore.deleteBranchFromExplorer is a no-op when the confirm dialog is dismissed', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const branchNode = findBranch(sections, fixture.otherBranch);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => undefined;
    try {
      await vscode.commands.executeCommand(COMMANDS.deleteBranchFromExplorer, branchNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(branches.some((b) => b.name === fixture.otherBranch), 'branch must survive a dismissed confirm');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run compile && npm run test:integration`
Expected: FAIL — `COMMANDS.renameBranchFromExplorer` and `COMMANDS.deleteBranchFromExplorer` are `undefined`, `executeCommand` rejects with "command not found".

- [ ] **Step 3: Add the two `GitService` methods**

In `src/core/git/GitService.ts`, immediately after `createBranch` (after its closing `}` around line 663):

```typescript
  /**
   * Deletes a local branch. `force: false` uses `-d` (git refuses if the branch has unmerged
   * commits); `force: true` uses `-D`. Never targets a remote-tracking ref — deleting one of
   * those is a push operation (`git push origin --delete`), out of scope here. Caller confirms
   * first; git itself refuses to delete the currently checked-out branch.
   */
  async deleteBranch(filePath: string, name: string, force: boolean): Promise<void> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    const args = ['branch', force ? '-D' : '-d', name];
    try {
      await this.gitFor(repoRoot).raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git branch ${force ? '-D' : '-d'} ${name} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Renames a local branch, including the currently checked-out one — `git branch -m` supports both. */
  async renameBranch(filePath: string, oldName: string, newName: string): Promise<void> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    const args = ['branch', '-m', oldName, newName];
    try {
      await this.gitFor(repoRoot).raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git branch -m ${oldName} ${newName} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }
```

- [ ] **Step 4: Add the command IDs**

In `src/constants.ts`, in the `COMMANDS` object, after `mergeBranchFromExplorer`/`rebaseOntoBranchFromExplorer` (~line 44):

```typescript
  deleteBranchFromExplorer: 'gitLore.deleteBranchFromExplorer',
  renameBranchFromExplorer: 'gitLore.renameBranchFromExplorer',
```

- [ ] **Step 5: Add the command handlers**

In `src/commands/explorerCommands.ts`, after `handleRebaseOntoBranchCommand` (after its closing `}`):

```typescript
export function handleRenameBranchCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.renameBranchFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch' || node.branch.isRemote) {
      return;
    }
    const newName = await vscode.window.showInputBox({
      prompt: `New name for '${node.branch.name}'`,
      value: node.branch.name,
    });
    if (!newName || newName === node.branch.name) {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.renameBranch(filePath, node.branch.name, newName);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't rename '${node.branch.name}' — ${errorMessage(err)}`);
    }
  });
}

export function handleDeleteBranchCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.deleteBranchFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'branch' || node.branch.isRemote || node.branch.isCurrent) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete local branch '${node.branch.name}'? This can't be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.deleteBranch(filePath, node.branch.name, false);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't delete '${node.branch.name}' — ${errorMessage(err)}`);
    }
  });
}
```

- [ ] **Step 6: Register the commands in `extension.ts`**

Add `handleDeleteBranchCommand` and `handleRenameBranchCommand` to the `explorerCommands` import block (next to `handleApplyStashCommand`), and add both to the `ctx.subscriptions.push(...)` list next to `handleApplyStashCommand(git, repoExplorerProvider)`:

```typescript
    handleDeleteBranchCommand(git, repoExplorerProvider),
    handleRenameBranchCommand(git, repoExplorerProvider),
```

- [ ] **Step 7: Wire the `package.json` commands and context menu**

In the top-level `contributes.commands` array, add:

```json
    {
      "command": "gitLore.renameBranchFromExplorer",
      "title": "GitLore: Rename Branch",
      "icon": "$(edit)"
    },
    {
      "command": "gitLore.deleteBranchFromExplorer",
      "title": "GitLore: Delete Branch",
      "icon": "$(trash)"
    },
```

In `contributes.menus.view/item/context`, add after the existing `gitLore.rebaseOntoBranchFromExplorer` entry (local branches only — `gitLore.branch` covers non-current local branches; renaming is also valid for the current branch, so it additionally matches `gitLore.branch.current`; deleting is not, since git refuses to delete a checked-out branch):

```json
        {
          "command": "gitLore.renameBranchFromExplorer",
          "when": "view == gitLore.explorer && (viewItem == gitLore.branch || viewItem == gitLore.branch.current)"
        },
        {
          "command": "gitLore.deleteBranchFromExplorer",
          "when": "view == gitLore.explorer && viewItem == gitLore.branch"
        },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run compile && npm run test:integration`
Expected: PASS

- [ ] **Step 9: Update `README.md` and `CHANGELOG.md`**

Add a line under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added

- **Sidebar Explorer: rename and delete a local branch** — right-click a branch for **Rename Branch** (also available on the current branch) and **Delete Branch** (confirms first; git itself blocks deleting the branch you have checked out).
```

Add the corresponding line to `README.md`'s Sidebar Explorer feature bullet list (find the existing "Branches, Remotes, Tags..." bullet and extend it to mention rename/delete).

- [ ] **Step 10: Commit**

```bash
git add src/core/git/GitService.ts src/constants.ts src/commands/explorerCommands.ts src/extension.ts package.json test/integration/sidebarExplorer.test.ts CHANGELOG.md README.md
git commit -m "feat(explorer): rename and delete local branches"
```

---

### Task 2: Delete a tag

**Files:**
- Modify: `src/core/git/GitService.ts` (add method after `renameBranch`)
- Modify: `src/constants.ts`
- Modify: `src/commands/explorerCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Test: `test/integration/sidebarExplorer.test.ts`

**Interfaces:**
- Consumes: `ExplorerLeafNode` (kind `'tag'`, from Task 1's file — already exists)
- Produces: `GitService.deleteTag(filePath: string, name: string): Promise<void>`
- Produces: `COMMANDS.deleteTagFromExplorer`
- Produces: `handleDeleteTagCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable`

- [ ] **Step 1: Write the failing integration test**

Append to `test/integration/sidebarExplorer.test.ts`:

```typescript
  test('gitLore.deleteTagFromExplorer requires confirmation and then deletes the tag', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const tagNode = section(sections, 'tags').children.find((n) => n.kind === 'tag' && n.tag.name === fixture.tagName);
    assert.ok(tagNode, `no tag node named '${fixture.tagName}'`);

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Delete';
    try {
      await vscode.commands.executeCommand(COMMANDS.deleteTagFromExplorer, tagNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const tags = await api.git.getTags(fixture.trackedFile);
    assert.ok(!tags.some((t) => t.name === fixture.tagName), 'tag was not deleted');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run compile && npm run test:integration`
Expected: FAIL — `COMMANDS.deleteTagFromExplorer` is `undefined`.

- [ ] **Step 3: Add `GitService.deleteTag`**

In `src/core/git/GitService.ts`, after `renameBranch`:

```typescript
  /** Deletes a local tag. Never touches a remote — deleting there is a separate push operation. */
  async deleteTag(filePath: string, name: string): Promise<void> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    const args = ['tag', '-d', name];
    try {
      await this.gitFor(repoRoot).raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git tag -d ${name} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }
```

- [ ] **Step 4: Add the command ID**

In `src/constants.ts`, after `renameBranchFromExplorer`:

```typescript
  deleteTagFromExplorer: 'gitLore.deleteTagFromExplorer',
```

- [ ] **Step 5: Add the command handler**

In `src/commands/explorerCommands.ts`, after `handleDeleteBranchCommand`:

```typescript
export function handleDeleteTagCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.deleteTagFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'tag') {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete tag '${node.tag.name}'? This can't be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.deleteTag(filePath, node.tag.name);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't delete tag '${node.tag.name}' — ${errorMessage(err)}`);
    }
  });
}
```

- [ ] **Step 6: Register in `extension.ts`**

Add `handleDeleteTagCommand` to the import block and push `handleDeleteTagCommand(git, repoExplorerProvider)` next to the branch handlers.

- [ ] **Step 7: Wire `package.json`**

Add to `contributes.commands`:

```json
    {
      "command": "gitLore.deleteTagFromExplorer",
      "title": "GitLore: Delete Tag",
      "icon": "$(trash)"
    },
```

Add to `contributes.menus.view/item/context`:

```json
        {
          "command": "gitLore.deleteTagFromExplorer",
          "when": "view == gitLore.explorer && viewItem == gitLore.tag"
        },
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm run compile && npm run test:integration`
Expected: PASS

- [ ] **Step 9: Update `CHANGELOG.md`**

```markdown
- **Sidebar Explorer: delete a tag** — right-click any tag for **Delete Tag** (confirms first).
```

- [ ] **Step 10: Commit**

```bash
git add src/core/git/GitService.ts src/constants.ts src/commands/explorerCommands.ts src/extension.ts package.json test/integration/sidebarExplorer.test.ts CHANGELOG.md
git commit -m "feat(explorer): delete a tag"
```

---

### Task 3: Add and remove a worktree

**Files:**
- Modify: `src/core/git/GitService.ts`
- Modify: `src/core/explorer/buildExplorerTree.ts` (section `contextValue`)
- Modify: `src/providers/RepoExplorerProvider.ts` (section `contextValue`)
- Modify: `src/constants.ts`
- Modify: `src/commands/explorerCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Test: `test/integration/sidebarExplorer.test.ts`

**Interfaces:**
- Produces: `GitService.addWorktree(filePath: string, worktreePath: string, branch: string): Promise<void>`
- Produces: `GitService.removeWorktree(filePath: string, worktreePath: string): Promise<void>`
- Produces: `ExplorerSectionNode` gains a stable `contextValue` of `gitLore.section.${id}` on every section's `TreeItem` (needed so "Add Worktree" can attach to the **Worktrees** section header, since there's no existing worktree row to right-click when the workspace has none yet)
- Produces: `COMMANDS.addWorktreeFromExplorer`, `COMMANDS.removeWorktreeFromExplorer`

- [ ] **Step 1: Write the failing integration test**

Append to `test/integration/sidebarExplorer.test.ts`:

```typescript
  test('gitLore.addWorktreeFromExplorer creates a worktree at a chosen path and branch', async () => {
    const fixture = buildExplorerFixtureRepo();
    const sections = await openExplorerFor(fixture);
    const worktreesSection = section(sections, 'worktrees');

    const worktreePath = join(dirname(fixture.repoRoot), `wt-${Date.now()}`);
    const originalInputBox = vscode.window.showInputBox;
    let call = 0;
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => (call++ === 0 ? worktreePath : fixture.otherBranch);
    try {
      await vscode.commands.executeCommand(COMMANDS.addWorktreeFromExplorer, worktreesSection);
    } finally {
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    const worktrees = await api.git.getWorktrees(fixture.trackedFile);
    assert.ok(worktrees.some((w) => w.path === worktreePath), 'new worktree not found');
  });

  test('gitLore.removeWorktreeFromExplorer requires confirmation and then removes a linked worktree', async () => {
    const fixture = buildExplorerFixtureRepo();
    const worktreePath = join(dirname(fixture.repoRoot), `wt-remove-${Date.now()}`);
    await api.git.addWorktree(fixture.trackedFile, worktreePath, fixture.otherBranch);
    const sections = await openExplorerFor(fixture);
    const worktreeNode = section(sections, 'worktrees').children.find((n) => n.kind === 'worktree' && n.worktree.path === worktreePath);
    assert.ok(worktreeNode, 'linked worktree not found in tree');

    const original = vscode.window.showWarningMessage;
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = async () => 'Remove';
    try {
      await vscode.commands.executeCommand(COMMANDS.removeWorktreeFromExplorer, worktreeNode);
    } finally {
      (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage = original;
    }

    const worktrees = await api.git.getWorktrees(fixture.trackedFile);
    assert.ok(!worktrees.some((w) => w.path === worktreePath), 'worktree was not removed');
  });
```

Add the two new imports at the top of the file:

```typescript
import { dirname, join } from 'node:path';
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run compile && npm run test:integration`
Expected: FAIL — `GitService.addWorktree` is not a function.

- [ ] **Step 3: Add `GitService.addWorktree` and `removeWorktree`**

In `src/core/git/GitService.ts`, after `getWorktrees` (~line 489):

```typescript
  /** Creates a new linked worktree at `worktreePath`, checking out `branch` there. */
  async addWorktree(filePath: string, worktreePath: string, branch: string): Promise<void> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    const args = ['worktree', 'add', worktreePath, branch];
    try {
      await this.gitFor(repoRoot).raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git worktree add ${worktreePath} ${branch} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }

  /** Removes a linked worktree. Never the main checkout — the caller filters that out before calling this. */
  async removeWorktree(filePath: string, worktreePath: string): Promise<void> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    const args = ['worktree', 'remove', worktreePath];
    try {
      await this.gitFor(repoRoot).raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git worktree remove ${worktreePath} failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }
```

- [ ] **Step 4: Give every Explorer section a stable `contextValue`**

In `src/providers/RepoExplorerProvider.ts`, in `getTreeItem`'s `element.kind === 'section'` branch, add one line after `item.iconPath = ...`:

```typescript
      item.contextValue = `gitLore.section.${element.id}`;
```

- [ ] **Step 5: Add the command IDs**

In `src/constants.ts`, after `deleteTagFromExplorer`:

```typescript
  addWorktreeFromExplorer: 'gitLore.addWorktreeFromExplorer',
  removeWorktreeFromExplorer: 'gitLore.removeWorktreeFromExplorer',
```

- [ ] **Step 6: Add the command handlers**

In `src/commands/explorerCommands.ts`, after `handleDeleteTagCommand`. `addWorktree` takes the **section node** (not a leaf), so it narrows on `ExplorerNode` including `ExplorerSectionNode`, imported alongside `ExplorerLeafNode`:

```typescript
import type { ExplorerLeafNode, ExplorerNode } from '../core/explorer/buildExplorerTree';
```

```typescript
export function handleAddWorktreeCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.addWorktreeFromExplorer, async (node?: ExplorerNode) => {
    if (node?.kind !== 'section' || node.id !== 'worktrees') {
      return;
    }
    const worktreePath = await vscode.window.showInputBox({
      prompt: 'Path for the new worktree',
      placeHolder: '/path/to/new-worktree',
    });
    if (!worktreePath) {
      return;
    }
    const branch = await vscode.window.showInputBox({
      prompt: 'Branch to check out in the new worktree',
      placeHolder: 'feature/my-branch',
    });
    if (!branch) {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.addWorktree(filePath, worktreePath, branch);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't add worktree at '${worktreePath}' — ${errorMessage(err)}`);
    }
  });
}

export function handleRemoveWorktreeCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.removeWorktreeFromExplorer, async (node?: ExplorerLeafNode) => {
    if (node?.kind !== 'worktree' || node.worktree.isMain) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Remove worktree at '${node.worktree.path}'? This can't be undone.`,
      { modal: true },
      'Remove',
    );
    if (confirmed !== 'Remove') {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.removeWorktree(filePath, node.worktree.path);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't remove worktree at '${node.worktree.path}' — ${errorMessage(err)}`);
    }
  });
}
```

- [ ] **Step 7: Register in `extension.ts`**

Add both handlers to the import block and `ctx.subscriptions.push(...)`.

- [ ] **Step 8: Wire `package.json`**

Add to `contributes.commands`:

```json
    {
      "command": "gitLore.addWorktreeFromExplorer",
      "title": "GitLore: Add Worktree",
      "icon": "$(add)"
    },
    {
      "command": "gitLore.removeWorktreeFromExplorer",
      "title": "GitLore: Remove Worktree",
      "icon": "$(trash)"
    },
```

Add to `contributes.menus.view/item/context`:

```json
        {
          "command": "gitLore.addWorktreeFromExplorer",
          "when": "view == gitLore.explorer && viewItem == gitLore.section.worktrees",
          "group": "inline"
        },
        {
          "command": "gitLore.removeWorktreeFromExplorer",
          "when": "view == gitLore.explorer && viewItem == gitLore.worktree"
        },
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm run compile && npm run test:integration`
Expected: PASS

- [ ] **Step 10: Update `CHANGELOG.md`**

```markdown
- **Sidebar Explorer: create and remove worktrees** — an inline **+** on the Worktrees section header prompts for a path and branch; right-click any linked worktree (not the main checkout) for **Remove Worktree** (confirms first).
```

- [ ] **Step 11: Commit**

```bash
git add src/core/git/GitService.ts src/core/explorer/buildExplorerTree.ts src/providers/RepoExplorerProvider.ts src/constants.ts src/commands/explorerCommands.ts src/extension.ts package.json test/integration/sidebarExplorer.test.ts CHANGELOG.md
git commit -m "feat(explorer): add and remove worktrees"
```

---

### Task 4: Create a stash with a message

**Files:**
- Modify: `src/core/git/GitService.ts`
- Modify: `src/constants.ts`
- Modify: `src/commands/explorerCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Test: `test/integration/sidebarExplorer.test.ts`

**Interfaces:**
- Consumes: `ExplorerSectionNode` (Task 3's `contextValue` addition — reused, not redefined)
- Produces: `GitService.createStash(filePath: string, message?: string): Promise<void>`
- Produces: `COMMANDS.createStashFromExplorer`

- [ ] **Step 1: Write the failing integration test**

Append to `test/integration/sidebarExplorer.test.ts`:

```typescript
  test('gitLore.createStashFromExplorer stashes the working tree with a message', async () => {
    const fixture = buildExplorerFixtureRepo();
    // The fixture's own pre-made stash (from its manifest) already occupies index 0; make a
    // fresh, distinguishable uncommitted change so this test isn't just re-stashing that one.
    const { appendFileSync } = await import('node:fs');
    appendFileSync(fixture.trackedFile, '\nanother uncommitted change\n');
    const sections = await openExplorerFor(fixture);
    const stashesSection = section(sections, 'stashes');
    const stashesBefore = await api.git.getStashes(fixture.trackedFile);

    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => 'my new stash';
    try {
      await vscode.commands.executeCommand(COMMANDS.createStashFromExplorer, stashesSection);
    } finally {
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    const stashesAfter = await api.git.getStashes(fixture.trackedFile);
    assert.equal(stashesAfter.length, stashesBefore.length + 1);
    assert.ok(stashesAfter.some((s) => s.message.includes('my new stash')));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run compile && npm run test:integration`
Expected: FAIL — `COMMANDS.createStashFromExplorer` is `undefined`.

- [ ] **Step 3: Add `GitService.createStash`**

In `src/core/git/GitService.ts`, after `dropStash`:

```typescript
  /** Stashes the working tree (and index) with an optional message, for the Sidebar Explorer's "New Stash" action. Throws if there's nothing to stash. */
  async createStash(filePath: string, message?: string): Promise<void> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return;
    }
    const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
    try {
      await this.gitFor(repoRoot).raw(args);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git stash push failed`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }
```

- [ ] **Step 4: Add the command ID**

In `src/constants.ts`, after `removeWorktreeFromExplorer`:

```typescript
  createStashFromExplorer: 'gitLore.createStashFromExplorer',
```

- [ ] **Step 5: Add the command handler**

In `src/commands/explorerCommands.ts`, after `handleRemoveWorktreeCommand`:

```typescript
export function handleCreateStashCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.createStashFromExplorer, async (node?: ExplorerNode) => {
    if (node?.kind !== 'section' || node.id !== 'stashes') {
      return;
    }
    const message = await vscode.window.showInputBox({
      prompt: 'Stash message (optional)',
      placeHolder: 'WIP: describe your changes',
    });
    // An empty string and a dismissed input box both come back falsy from showInputBox — either
    // way, `message || undefined` below falls back to a plain `git stash push` with no -m.
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    try {
      await git.createStash(filePath, message || undefined);
      await explorer.refreshCurrent();
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't create stash — ${errorMessage(err)}`);
    }
  });
}
```

- [ ] **Step 6: Register in `extension.ts`**

Add `handleCreateStashCommand` to the import block and `ctx.subscriptions.push(...)`.

- [ ] **Step 7: Wire `package.json`**

Add to `contributes.commands`:

```json
    {
      "command": "gitLore.createStashFromExplorer",
      "title": "GitLore: New Stash",
      "icon": "$(add)"
    },
```

Add to `contributes.menus.view/item/context`:

```json
        {
          "command": "gitLore.createStashFromExplorer",
          "when": "view == gitLore.explorer && viewItem == gitLore.section.stashes",
          "group": "inline"
        },
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm run compile && npm run test:integration`
Expected: PASS

- [ ] **Step 9: Update `CHANGELOG.md`**

```markdown
- **Sidebar Explorer: create a stash** — an inline **+** on the Stashes section header prompts for an optional message and stashes the working tree.
```

- [ ] **Step 10: Commit**

```bash
git add src/core/git/GitService.ts src/constants.ts src/commands/explorerCommands.ts src/extension.ts package.json test/integration/sidebarExplorer.test.ts CHANGELOG.md
git commit -m "feat(explorer): create a stash with a message"
```

---

### Task 5: Reflog-backed recovery command

**Files:**
- Modify: `src/core/git/types.ts` (new `ReflogEntry`)
- Modify: `src/core/git/parsers.ts` (new `parseReflog`)
- Modify: `src/core/git/GitService.ts` (new `getReflog`)
- Modify: `src/constants.ts`
- Create: `src/commands/reflogCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (`commands` + a `commandPalette` entry — this one isn't attached to a tree item, it's invoked from the Command Palette)
- Test: `test/unit/core/git/parsers.reflog.test.ts` (new)
- Test: `test/integration/sidebarExplorer.test.ts`

**Interfaces:**
- Produces: `ReflogEntry { sha: string; selector: string; message: string; date: string }` (in `src/core/git/types.ts`)
- Produces: `parseReflog(raw: string): ReflogEntry[]` (pure, in `src/core/git/parsers.ts`)
- Produces: `GitService.getReflog(filePath: string, maxCount: number): Promise<ReflogEntry[]>`
- Produces: `COMMANDS.recoverFromReflog`
- Produces: `handleRecoverFromReflogCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable`

- [ ] **Step 1: Write the failing parser unit test**

Create `test/unit/core/git/parsers.reflog.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReflog } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';

test('parseReflog: extracts sha, selector, message, and date per entry', () => {
  const raw = [
    `a1b2c3d4e5f60708090a0b0c0d0e0f1011121314${FIELD}HEAD@{0}${FIELD}reset: moving to HEAD~1${FIELD}2026-08-19T10:00:00+05:30`,
    `4e5f6a70b1c2d3e4f5061708090a0b0c0d0e0f10${FIELD}HEAD@{1}${FIELD}commit: fix bug${FIELD}2026-08-19T09:00:00+05:30`,
  ].join('\n');
  assert.deepEqual(parseReflog(raw), [
    { sha: 'a1b2c3d4e5f60708090a0b0c0d0e0f1011121314', selector: 'HEAD@{0}', message: 'reset: moving to HEAD~1', date: '2026-08-19T10:00:00+05:30' },
    { sha: '4e5f6a70b1c2d3e4f5061708090a0b0c0d0e0f10', selector: 'HEAD@{1}', message: 'commit: fix bug', date: '2026-08-19T09:00:00+05:30' },
  ]);
});

test('parseReflog: empty output produces an empty array', () => {
  assert.deepEqual(parseReflog(''), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `parseReflog` is not exported from `../../../../src/core/git/parsers`.

- [ ] **Step 3: Add `ReflogEntry` and `parseReflog`**

In `src/core/git/types.ts`, after `WorktreeInfo`:

```typescript
/** One entry from `git reflog` — where HEAD (or a branch) pointed at some past moment, for recovering a lost commit or branch. */
export interface ReflogEntry {
  sha: string;
  /** e.g. `HEAD@{0}` — what `git branch <name> <selector>` needs to recreate a branch at this point. */
  selector: string;
  /** The reflog subject, e.g. "commit: fix bug" or "reset: moving to HEAD~1". */
  message: string;
  /** ISO 8601 timestamp. */
  date: string;
}
```

In `src/core/git/parsers.ts`, after `parseWorktrees`:

```typescript
/** Parses `git reflog show --date=iso-strict --format=%H<FIELD>%gd<FIELD>%gs<FIELD>%cd` output. Pure — no I/O. */
export function parseReflog(raw: string): ReflogEntry[] {
  const entries: ReflogEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [sha, selector, message, date] = line.split(LOG_FIELD_SEP);
    if (sha && selector) {
      entries.push({ sha, selector, message: message ?? '', date: date ?? '' });
    }
  }
  return entries;
}
```

Add `ReflogEntry` to the `import type { ... } from './types'` block at the top of `parsers.ts`.

- [ ] **Step 4: Run to verify the parser test passes**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Write the failing integration test for the command**

Append to `test/integration/sidebarExplorer.test.ts`:

```typescript
  test('gitLore.recoverFromReflog lists reflog entries and creates a branch at the chosen one', async () => {
    const fixture = buildExplorerFixtureRepo();
    await openExplorerFor(fixture);
    const entries = await api.git.getReflog(fixture.trackedFile, 50);
    assert.ok(entries.length > 0, 'fixture repo must have reflog entries');

    const originalQuickPick = vscode.window.showQuickPick;
    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = async (items: { entry: ReflogEntry }[]) => items[0];
    (vscode.window as unknown as { showInputBox: unknown }).showInputBox = async () => 'recovered-branch';
    try {
      await vscode.commands.executeCommand(COMMANDS.recoverFromReflog);
    } finally {
      (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = originalQuickPick;
      (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalInputBox;
    }

    const branches = await api.git.getBranches(fixture.trackedFile);
    assert.ok(branches.some((b) => b.name === 'recovered-branch'), 'recovery branch not created');
  });
```

Add `ReflogEntry` to this test file's type-only import from `'../../src/core/git/types'` (introduce that import line if it doesn't exist yet).

Note: `gitLore.recoverFromReflog` isn't attached to a workspace file the way other Explorer commands are — the fixture's `trackedFile` must already be the active editor from the preceding `openExplorerFor` call so `resolveRepoContextPath()` resolves correctly, exactly like every other test in this file.

- [ ] **Step 6: Run to verify it fails**

Run: `npm run compile && npm run test:integration`
Expected: FAIL — `GitService.getReflog` is not a function.

- [ ] **Step 7: Add `GitService.getReflog`**

In `src/core/git/GitService.ts`, after `getWorktrees` (or after Task 3's `removeWorktree`, whichever lands last — keep worktree/reflog reads adjacent):

```typescript
  /** The last `maxCount` reflog entries for HEAD — the raw material for recovering a lost commit or branch. */
  async getReflog(filePath: string, maxCount: number): Promise<ReflogEntry[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    const args = ['reflog', 'show', '-n', String(maxCount), '--date=iso-strict', `--format=%H${'\x1f'}%gd${'\x1f'}%gs${'\x1f'}%cd`];
    try {
      const raw = await this.gitFor(repoRoot).raw(args);
      return parseReflog(raw);
    } catch {
      // An empty repo (no commits yet, so no reflog) — no entries, not an error.
      return [];
    }
  }
```

Add `parseReflog` to the `import { ... } from './parsers'` block and `ReflogEntry` to the `import type { ... } from './types'` block at the top of `GitService.ts`.

- [ ] **Step 8: Add the command ID**

In `src/constants.ts`, after `createStashFromExplorer`:

```typescript
  recoverFromReflog: 'gitLore.recoverFromReflog',
```

- [ ] **Step 9: Add the command handler in a new file**

Create `src/commands/reflogCommands.ts` — a new file (not appended to `explorerCommands.ts`) since this command isn't triggered from an Explorer tree item, it's a standalone Command Palette entry:

```typescript
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GitService } from '../core/git/GitService';
import { GitCommandError } from '../core/git/errors';
import type { ReflogEntry } from '../core/git/types';
import { resolveRepoContextPath } from '../views/CommitGraph/CommitGraphViewProvider';
import type { RepoExplorerProvider } from '../providers/RepoExplorerProvider';

function errorMessage(err: unknown): string {
  return err instanceof GitCommandError ? err.stderr : err instanceof Error ? err.message : String(err);
}

/** Lists recent reflog entries and creates a branch at the chosen one — recovers a commit or branch a hard reset, force push, or accidental delete left dangling but not yet garbage-collected. */
export function handleRecoverFromReflogCommand(git: GitService, explorer: RepoExplorerProvider): vscode.Disposable {
  return vscode.commands.registerCommand(COMMANDS.recoverFromReflog, async () => {
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    const entries = await git.getReflog(filePath, 100);
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('GitLore: no reflog entries found.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((entry: ReflogEntry) => ({
        label: entry.selector,
        description: entry.message,
        detail: entry.sha.slice(0, 7),
        entry,
      })),
      { placeHolder: 'Recover a commit or branch from the reflog' },
    );
    if (!picked) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: `New branch name at ${picked.entry.selector}`,
      placeHolder: 'recovered-branch',
    });
    if (!name) {
      return;
    }
    try {
      await git.createBranch(filePath, name, picked.entry.sha);
      await explorer.refreshCurrent();
      void vscode.window.showInformationMessage(`GitLore: created branch '${name}' at ${picked.entry.selector}.`);
    } catch (err) {
      void vscode.window.showErrorMessage(`GitLore: couldn't recover from reflog — ${errorMessage(err)}`);
    }
  });
}
```

- [ ] **Step 10: Register in `extension.ts`**

Import `handleRecoverFromReflogCommand` from `'./commands/reflogCommands'` and push `handleRecoverFromReflogCommand(git, repoExplorerProvider)` into `ctx.subscriptions`.

- [ ] **Step 11: Wire `package.json`**

Add to `contributes.commands` (no `icon` — this is Command Palette-only, not attached to any toolbar or tree item):

```json
    {
      "command": "gitLore.recoverFromReflog",
      "title": "GitLore: Recover Lost Commit or Branch"
    },
```

- [ ] **Step 12: Run to verify everything passes**

Run: `npm run compile && npm run test:unit && npm run test:integration`
Expected: PASS

- [ ] **Step 13: Update `CHANGELOG.md`** and add a new feature bullet to `README.md`'s command list

```markdown
- **Recover Lost Commit or Branch** — a new command (`GitLore: Recover Lost Commit or Branch`) lists recent reflog entries and creates a branch at whichever one you pick, for recovering from a hard reset, force push, or accidental branch delete before git garbage-collects it.
```

- [ ] **Step 14: Commit**

```bash
git add src/core/git/types.ts src/core/git/parsers.ts src/core/git/GitService.ts src/constants.ts src/commands/reflogCommands.ts src/extension.ts package.json test/unit/core/git/parsers.reflog.test.ts test/integration/sidebarExplorer.test.ts CHANGELOG.md README.md
git commit -m "feat: recover a lost commit or branch from the reflog"
```

---

### Task 6: `.git-blame-ignore-revs` support

**Files:**
- Modify: `src/core/git/GitService.ts` (`blameFile`)
- Test: `test/integration/hover.test.ts` (existing blame integration coverage) or a new focused test — see Step 1

**Interfaces:**
- Modifies: `GitService.blameFile(filePath: string, opts: BlameOptions = {}): Promise<BlameLine[]>` — behavior change only, signature unchanged

- [ ] **Step 1: Write the failing test**

This needs a fixture repo with a `.git-blame-ignore-revs` file and a commit to ignore. Add a focused integration test file `test/integration/blameIgnoreRevs.test.ts`:

```typescript
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { GitLoreTestApi } from '../../src/extension';
import { EXTENSION_ID } from './extensionId';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

suite('.git-blame-ignore-revs', () => {
  let api: GitLoreTestApi;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<GitLoreTestApi>(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
  });

  test('blameFile skips a commit listed in .git-blame-ignore-revs, attributing the line to the prior commit', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'gitlore-ignore-revs-'));
    git(repoRoot, ['init', '-q', '-b', 'main']);
    git(repoRoot, ['config', 'user.name', 'Raj Jadon']);
    git(repoRoot, ['config', 'user.email', 'raj@example.com']);
    const trackedFile = join(repoRoot, 'tracked.txt');
    writeFileSync(trackedFile, 'original line\n');
    git(repoRoot, ['add', 'tracked.txt']);
    git(repoRoot, ['commit', '-q', '-m', 'original commit']);

    appendFileSync(trackedFile, 'reformatted line\n');
    git(repoRoot, ['add', 'tracked.txt']);
    git(repoRoot, ['commit', '-q', '-m', 'reformat: bulk whitespace fix']);
    const reformatSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

    writeFileSync(join(repoRoot, '.git-blame-ignore-revs'), `${reformatSha}\n`);

    const blamedWithoutIgnore = await api.git.blameFile(trackedFile);
    assert.equal(blamedWithoutIgnore[1]?.summary, 'reformat: bulk whitespace fix');

    git(repoRoot, ['add', '.git-blame-ignore-revs']);
    git(repoRoot, ['commit', '-q', '-m', 'add ignore-revs file']);

    const blamedWithIgnore = await api.git.blameFile(trackedFile);
    // Line 1 (0-indexed) is "reformatted line" — with the reformat commit ignored, git attributes
    // it to whichever commit last touched it before the ignored one: the original commit.
    assert.notEqual(blamedWithIgnore[1]?.summary, 'reformat: bulk whitespace fix');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run compile && npm run test:integration`
Expected: FAIL — both blame calls return the same result, since `blameFile` doesn't look for `.git-blame-ignore-revs` yet.

- [ ] **Step 3: Implement the flag**

In `src/core/git/GitService.ts`, add `existsSync` and `join` to the existing `node:fs`/`node:path` imports at the top:

```typescript
import { dirname, join } from 'node:path';
import { realpathSync, statSync, existsSync } from 'node:fs';
```

Then update `blameFile` (the method built around line 111):

```typescript
  /** Blames the whole file in one call — never shell out per line. */
  async blameFile(filePath: string, opts: BlameOptions = {}): Promise<BlameLine[]> {
    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    if (!(await this.isTracked(filePath))) {
      return [];
    }

    const git = this.gitFor(repoRoot);
    const rel = toRepoRelativePath(repoRoot, this.toCanonicalPath(filePath));
    const args = ['blame', '--line-porcelain'];
    if (opts.ignoreWhitespace) {
      args.push('-w');
    }
    // git's own convention (supported since 2.23) for skipping mass-reformat/lint commits in
    // blame — auto-detected by filename, no setting needed, opt-in by simply having the file.
    const ignoreRevsFile = join(repoRoot, '.git-blame-ignore-revs');
    if (existsSync(ignoreRevsFile)) {
      args.push('--ignore-revs-file', ignoreRevsFile);
    }
    args.push('--', rel);

    try {
      const raw = await git.raw(args);
      return parseBlamePorcelain(raw);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      this.logger?.error(`git blame failed for ${filePath}`, err);
      throw new GitCommandError(args.join(' '), stderr);
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run compile && npm run test:integration`
Expected: PASS

- [ ] **Step 5: Update `CHANGELOG.md`** and `README.md`'s blame feature bullet

```markdown
- **Inline blame respects `.git-blame-ignore-revs`** — if your repo has one (git's own standard convention for mass-reformat/lint commits you don't want blame attributing to), GitLore's blame now skips those commits automatically. No setting — same as plain `git blame`, GitLore just detects the file.
```

- [ ] **Step 6: Commit**

```bash
git add src/core/git/GitService.ts test/integration/blameIgnoreRevs.test.ts CHANGELOG.md README.md
git commit -m "feat(blame): respect .git-blame-ignore-revs"
```

---

### Task 7: Standalone Fetch button

**Files:**
- Modify: `src/views/icons.ts` — new `FETCH_ICON` (CommitGraph and Launchpad each already use `REFRESH_ICON` for their own "reload the local view" button — reusing it for Fetch, a distinct remote-talking action right next to it, would make two different actions look identical, which is exactly what CLAUDE.md §18 already warns against for color; the same logic applies to icon identity)
- Modify: `src/views/CommitGraph/render.ts`, `src/views/CommitGraph/CommitGraphViewProvider.ts`
- Modify: `src/views/Launchpad/render.ts`, `src/views/Launchpad/LaunchpadViewProvider.ts`
- Test: `test/unit/views/commitGraph.render.test.ts`, `test/unit/views/launchpad.render.test.ts`
- Test: `test/integration/commitGraph.test.ts`, `test/integration/launchpad.test.ts`

**Interfaces:**
- Produces: `FETCH_ICON` (in `src/views/icons.ts`)
- Modifies: `CommitGraphViewProvider`'s webview message handler — adds a `'fetch'` case alongside the existing `'pull'`/`'push'` handling
- Modifies: `LaunchpadViewProvider.syncRepo(repoKey: string, direction: 'pull' | 'push' | 'fetch')` — widens the existing `direction` union

- [ ] **Step 1: Add `FETCH_ICON`**

In `src/views/icons.ts`, after `REFRESH_ICON`:

```typescript
/** Fetch — a cloud with a download arrow, distinct from REFRESH_ICON (reload the local view) and ARROW_DOWN_ICON (Pull, which also merges). */
export const FETCH_ICON = icon(
  '<path d="M4.6 9.8h6.9a2.4 2.4 0 0 0 .3-4.78 3.3 3.3 0 0 0-6.1-1A2.7 2.7 0 0 0 4.6 9.8Z" /><path d="M8 9.8v4.7" /><path d="M6 12.5 8 14.5l2-2" />',
  'toolbar-icon',
  13,
);
```

- [ ] **Step 2: Write the failing render unit tests**

In `test/unit/views/commitGraph.render.test.ts`, add right after the existing `'renderGraphHtml: pull/push buttons show ahead/behind badges for the current branch'` test (~line 290):

```typescript
test('renderGraphHtml: a Fetch button renders alongside Pull/Push, and is hidden with them when there is no upstream', () => {
  const withUpstream = renderGraphHtml(fixtureData({ branches: [currentBranch({ ahead: 6, behind: 5 })] }), fixtureOpts());
  assert.match(withUpstream, /id="fetch"[^>]*title="Fetch"/);

  const withoutUpstream = renderGraphHtml(fixtureData({ branches: [currentBranch({ ahead: undefined, behind: undefined })] }), fixtureOpts());
  assert.doesNotMatch(withoutUpstream, /id="fetch"/);
});
```

(Reuse whichever fixture-building helpers — e.g. `fixtureData`/`fixtureOpts`/`currentBranch` — the neighboring "pull/push buttons show ahead/behind badges" test above it already calls; match its exact argument shape rather than the names above if they differ.)

In `test/unit/views/launchpad.render.test.ts`, add right after `'renderLaunchpadHtml: renders a push/pull row per repo, keyed to that repo'` (~line 245):

```typescript
test('renderLaunchpadHtml: renders a Fetch button per repo, keyed to that repo, next to Pull/Push', () => {
  const html = renderLaunchpadHtml({ categorized: [], repoRows: [{ key: 'github:acme/widgets', label: 'acme/widgets' }], errors: [] });
  assert.match(html, /class="repo-fetch icon-btn" type="button" data-key="github:acme\/widgets"/);
});

test('renderLaunchpadHtml: repo Fetch button posts a keyed fetch message', () => {
  const html = renderLaunchpadHtml({ categorized: [], repoRows: [{ key: 'github:acme/widgets', label: 'acme/widgets' }], errors: [] });
  assert.match(html, /querySelectorAll\('\.repo-fetch'\)[\s\S]*?vscode\.postMessage\(\{ type: 'fetch', key: btn\.dataset\.key \}\);/);
});
```

(Match the exact `renderLaunchpadHtml` argument shape used by the neighboring `'renders a push/pull row per repo'` test above it, in case the real fixture object has more required fields than shown here.)

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — no `id="fetch"`/`.repo-fetch` in the rendered HTML yet.

- [ ] **Step 4: Add the Fetch button to Commit Graph's render**

In `src/views/CommitGraph/render.ts`, add `FETCH_ICON` to the icon import list, then update `renderSyncButtons` (~line 188) to add a fetch button before Pull, gated by the same "has upstream" check the function already returns early on:

```typescript
function renderSyncButtons(branches: BranchInfo[]): string {
  const current = branches.find((b) => b.isCurrent && !b.isRemote);
  if (!current || (current.ahead === undefined && current.behind === undefined)) {
    return '';
  }
  const behind = current.behind ?? 0;
  const ahead = current.ahead ?? 0;
  const pullBadge = behind > 0 ? `<span class="sync-badge">${behind}</span>` : '';
  const pushBadge = ahead > 0 ? `<span class="sync-badge">${ahead}</span>` : '';
  const pullLabel = behind > 0 ? `Pull ${behind} ${behind === 1 ? 'commit' : 'commits'}` : 'Pull — up to date';
  const pushLabel = ahead > 0 ? `Push ${ahead} ${ahead === 1 ? 'commit' : 'commits'}` : 'Push — nothing to push';
  return `<button id="fetch" class="icon-btn" type="button" title="Fetch" aria-label="Fetch">${FETCH_ICON}</button>
<button id="pull" class="icon-btn" type="button" title="${escapeHtml(pullLabel)}" aria-label="${escapeHtml(pullLabel)}">${ARROW_DOWN_ICON}${pullBadge}</button>
<button id="push" class="icon-btn" type="button" title="${escapeHtml(pushLabel)}" aria-label="${escapeHtml(pushLabel)}">${ARROW_UP_ICON}${pushBadge}</button>`;
}
```

In the same file's `<script>` block, right after the existing pull/push listeners (~line 552-557):

```javascript
document.getElementById('fetch')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'fetch' });
});
```

- [ ] **Step 5: Handle the message in `CommitGraphViewProvider`**

In `src/views/CommitGraph/CommitGraphViewProvider.ts`, replace the existing pull/push conditional (~line 428) in place:

```typescript
    if ((type === 'pull' || type === 'push' || type === 'fetch') && this.currentRepoRoot) {
      const command = type === 'pull' ? 'git pull' : type === 'push' ? 'git push' : 'git fetch';
      runInGitSyncTerminal(this.currentRepoRoot, command);
    }
```

- [ ] **Step 6: Add the Fetch button to Launchpad's per-repo row**

In `src/views/Launchpad/render.ts`, add `FETCH_ICON` to the icon import list, then update `renderRepoRow` (~line 106) to add a fetch button before Pull:

```typescript
function renderRepoRow(repo: LaunchpadRepoRow): string {
  const key = escapeHtml(repo.key);
  const label = escapeHtml(repo.label);
  return `<div class="repo-row" data-key="${key}">
<span class="repo-row-label">${label}</span>
<button class="repo-fetch icon-btn" type="button" data-key="${key}" data-tooltip="Fetch" aria-label="Fetch ${label}">${FETCH_ICON}</button>
<button class="repo-pull icon-btn" type="button" data-key="${key}" data-tooltip="Pull" aria-label="Pull ${label}">${ARROW_DOWN_ICON}</button>
<button class="repo-push icon-btn" type="button" data-key="${key}" data-tooltip="Push" aria-label="Push ${label}">${ARROW_UP_ICON}</button>
<button class="repo-signout icon-btn" type="button" data-key="${key}" data-title="${label}" data-tooltip="Sign Out" aria-label="Sign out of ${label}">${SIGN_OUT_ICON}</button>
</div>`;
}
```

At the bottom of the same file, right after the existing `.repo-pull`/`.repo-push` listener-wiring loops (~line 254-263):

```javascript
for (const btn of document.querySelectorAll('.repo-fetch')) {
  btn.addEventListener('click', () => {
    vscode.postMessage({ type: 'fetch', key: btn.dataset.key });
  });
}
```

- [ ] **Step 7: Widen `syncRepo` in `LaunchpadViewProvider`**

In `src/views/Launchpad/LaunchpadViewProvider.ts`, update the message handler and `syncRepo`:

```typescript
    if ((type === 'pull' || type === 'push' || type === 'fetch') && typeof key === 'string') {
      this.syncRepo(key, type);
    }
```

```typescript
  private syncRepo(repoKey: string, direction: 'pull' | 'push' | 'fetch'): void {
    const repoRoot = this.repoRootByKey.get(repoKey);
    if (!repoRoot) {
      return;
    }
    const command = direction === 'pull' ? 'git pull' : direction === 'push' ? 'git push' : 'git fetch';
    runInGitSyncTerminal(repoRoot, command);
  }

  /** Test-only introspection seam — a webview button click can't be simulated in an integration test, so this drives the same lookup-then-terminal flow the push/pull/fetch message handler does. */
  syncRepoForTest(repoKey: string, direction: 'pull' | 'push' | 'fetch'): void {
    this.syncRepo(repoKey, direction);
  }
```

- [ ] **Step 8: Run to verify the unit tests pass**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 9: Extend the one existing pull/push integration test to cover fetch**

Neither `test/integration/commitGraph.test.ts` nor `test/integration/launchpad.test.ts` currently asserts a terminal actually opens for a valid pull/push (that's covered at the unit-render level in Step 2 instead) — the only existing integration coverage is `launchpad.test.ts`'s `'syncRepoForTest: an unrecognized repo key is a silent no-op (no terminal created)'` (~line 899). Extend that one test to also cover `'fetch'`, matching its existing scope rather than adding new integration surface beyond precedent:

```typescript
  test('syncRepoForTest: an unrecognized repo key is a silent no-op (no terminal created)', async () => {
    const before = vscode.window.terminals.length;
    api.launchpadProvider.syncRepoForTest('not-a-real-repo-key', 'pull');
    api.launchpadProvider.syncRepoForTest('not-a-real-repo-key', 'push');
    api.launchpadProvider.syncRepoForTest('not-a-real-repo-key', 'fetch');
    assert.equal(vscode.window.terminals.length, before);
  });
```

- [ ] **Step 10: Run the full integration suite**

Run: `npm run compile && npm run test:integration`
Expected: PASS

- [ ] **Step 11: Update `CHANGELOG.md`**

```markdown
- **Fetch button** — Commit Graph's toolbar and Launchpad's per-repo row now have a Fetch button next to Pull/Push, same shared Git Sync terminal.
```

- [ ] **Step 12: Commit**

```bash
git add src/views/CommitGraph/render.ts src/views/CommitGraph/CommitGraphViewProvider.ts src/views/Launchpad/render.ts src/views/Launchpad/LaunchpadViewProvider.ts test/unit/views/commitGraph.render.test.ts test/unit/views/launchpad.render.test.ts test/integration/commitGraph.test.ts test/integration/launchpad.test.ts CHANGELOG.md
git commit -m "feat: add a standalone Fetch button to Commit Graph and Launchpad"
```

---

## Verification (whole plan)

After all 7 tasks:

- [ ] `npm run lint` — clean (eslint + `tsc --noEmit`)
- [ ] `npm run compile` — clean
- [ ] `npm run test` — full suite (`test:unit` + `test:integration`) passes
- [ ] Manually confirm in the Extension Development Host (F5): right-click a non-current local branch → Rename/Delete both work; right-click a tag → Delete works; Worktrees/Stashes section headers show an inline **+**; `GitLore: Recover Lost Commit or Branch` appears in the Command Palette; a `.git-blame-ignore-revs` file in a real repo changes blame attribution; Fetch buttons appear in both Commit Graph and Launchpad and open the shared terminal
