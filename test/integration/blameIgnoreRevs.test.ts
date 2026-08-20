import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
    writeFileSync(trackedFile, 'line one\nline two\n');
    git(repoRoot, ['add', 'tracked.txt']);
    git(repoRoot, ['commit', '-q', '-m', 'original commit']);

    // Rewrites line 2's *content* (not a newly-appended line) — --ignore-revs-file can only fall
    // back to a prior commit when that commit had content for the same line to fall back to; a
    // brand-new line has no such prior revision, so git would keep blaming the "ignored" commit
    // regardless of the flag. A rewritten line is the case the flag is actually built for.
    writeFileSync(trackedFile, 'line one\nline two reformatted\n');
    git(repoRoot, ['add', 'tracked.txt']);
    git(repoRoot, ['commit', '-q', '-m', 'reformat: bulk whitespace fix']);
    const reformatSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

    // Blame before the ignore-revs file exists on disk at all — `blameFile` detects it purely by
    // filesystem presence (matching plain `git blame`'s own behavior), so it must not exist yet
    // for this first call to see the un-ignored attribution.
    const blamedWithoutIgnore = await api.git.blameFile(trackedFile);
    assert.equal(blamedWithoutIgnore[1]?.summary, 'reformat: bulk whitespace fix');

    writeFileSync(join(repoRoot, '.git-blame-ignore-revs'), `${reformatSha}\n`);
    git(repoRoot, ['add', '.git-blame-ignore-revs']);
    git(repoRoot, ['commit', '-q', '-m', 'add ignore-revs file']);

    const blamedWithIgnore = await api.git.blameFile(trackedFile);
    // Line 1 (0-indexed) is "line two reformatted" — with the reformat commit ignored, git
    // attributes it to whichever commit last touched it before the ignored one: the original commit.
    assert.notEqual(blamedWithIgnore[1]?.summary, 'reformat: bulk whitespace fix');
  });
});
