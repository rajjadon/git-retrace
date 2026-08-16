/*
 * Regenerates the README's panel screenshots: `npm run shots`.
 *
 * These are real renders, not mockups. `src/core/` has zero `vscode` imports and the view renderers
 * are pure functions, so the exact HTML a webview would show can be produced in plain Node against
 * this repo's own git history, then photographed with headless Chrome.
 *
 * Two things are NOT real and are worth knowing:
 *   1. The theme. VS Code injects ~100 `--vscode-*` custom properties into every webview; this file
 *      approximates Dark Modern. If VS Code retunes that theme, these drift. Everything else —
 *      layout, markup, data, avatars — comes from the shipping code.
 *   2. There is no surrounding VS Code chrome (panel tab bar, title). Each image is the panel's
 *      content only.
 *
 * Native VS Code UI (editor decorations, CodeLenses, TreeViews, overview-ruler marks) has no HTML
 * to render this way at all — see `scripts/shoot-native-screenshots.ts` (`npm run shots:native`)
 * for those, which drives a real VS Code window instead.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GitService } from '../src/core/git/GitService';
import { layoutGraph } from '../src/core/graph/layout';
import { layoutFileHistory } from '../src/core/graph/fileHistoryLayout';
import type { ConversationThread, ForgeRepoRef, PullRequestSummary } from '../src/core/forge/types';
import { renderGraphHtml } from '../src/views/CommitGraph/render';
import { renderCommitDetailsHtml } from '../src/views/CommitDetails/render';
import { renderBranchComparisonHtml } from '../src/views/BranchComparison/render';
import { renderFileHistoryHtml } from '../src/views/VisualFileHistory/render';
import { renderRebaseEditorHtml } from '../src/views/RebaseEditor/render';
import { renderLaunchpadHtml } from '../src/views/Launchpad/render';
import { renderPullRequestDetailsHtml } from '../src/views/PullRequestDetails/render';

const REPO = resolve(__dirname, '..');
const MEDIA = join(REPO, 'media');
const OUT = join(MEDIA, 'screenshots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const cssUrl = (name: string): string => `file://${join(MEDIA, name)}`;

const THEME = `:root{
--vscode-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--vscode-font-size:13px;
--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-editor-background:#1f1f1f;
--vscode-panel-background:#181818;--vscode-panel-border:#2b2b2b;
--vscode-editor-font-family:Menlo,Monaco,monospace;--vscode-editor-font-size:12px;
--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;
--vscode-list-activeSelectionForeground:#ffffff;--vscode-list-inactiveSelectionBackground:#37373d;
--vscode-badge-background:#616161;--vscode-badge-foreground:#f8f8f8;
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;
--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;
--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;
--vscode-input-placeholderForeground:#989898;--vscode-dropdown-background:#313131;
--vscode-dropdown-foreground:#cccccc;--vscode-dropdown-border:#3c3c3c;--vscode-focusBorder:#0078d4;
--vscode-toolbar-hoverBackground:#313131;--vscode-textCodeBlock-background:#2b2b2b;
--vscode-textLink-foreground:#4daafc;--vscode-charts-blue:#4daafc;--vscode-charts-orange:#d18616;
--vscode-charts-green:#89d185;--vscode-charts-purple:#b180d7;--vscode-charts-red:#f14c4c;
--vscode-charts-yellow:#cca700;--vscode-charts-foreground:#cccccc;
--vscode-gitDecoration-addedResourceForeground:#81b88b;
--vscode-gitDecoration-modifiedResourceForeground:#e2c08d;
--vscode-gitDecoration-deletedResourceForeground:#c74e39;
--vscode-panelTitle-activeForeground:#e7e7e7;--vscode-panelTitle-inactiveForeground:#8f8f8f;
--vscode-panelTitle-activeBorder:#0078d4;--vscode-inputOption-activeBackground:#2489db;
--vscode-inputOption-activeForeground:#ffffff;--vscode-inputOption-activeBorder:#2488db;
--vscode-diffEditor-insertedTextBackground:rgba(155,185,85,0.16);
--vscode-diffEditor-removedTextBackground:rgba(255,70,70,0.16);
--vscode-menu-background:#1f1f1f;--vscode-menu-foreground:#cccccc;--vscode-menu-border:#454545;
--vscode-menu-selectionBackground:#04395e;--vscode-menu-selectionForeground:#ffffff;
--vscode-menu-separatorBackground:#454545;--vscode-editorHoverWidget-background:#252526;
--vscode-editorHoverWidget-foreground:#cccccc;}`;

/** A webview CSP blocks `file://` stylesheets. Irrelevant to a screenshot, so swap it for the theme. */
function forBrowser(html: string): string {
  return html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<style>${THEME}</style>`);
}

/** Expands the first file so the diff gutter — the thing worth showing — is actually visible. */
function expandFirstFile(html: string): string {
  return html.replace('<details class="file"', '<details class="file" open');
}

/** Forces the right-click context menu open at a fixed position — there's no real click to fire against a static render. */
function withOpenContextMenu(html: string, top: number, left: number): string {
  return html.replace(
    '<div id="commit-ctx-menu" class="ctx-menu" role="menu" hidden>',
    `<div id="commit-ctx-menu" class="ctx-menu" role="menu" style="top:${top}px;left:${left}px;">`,
  );
}

function shoot(dir: string, name: string, width: number, height: number): void {
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      // Avatars come from gravatar.com over the network; give them time to land.
      '--virtual-time-budget=4000',
      // 2x so the images stay sharp on the Marketplace and on retina displays.
      '--force-device-scale-factor=2',
      `--window-size=${width},${height}`,
      `--screenshot=${join(OUT, `${name}.png`)}`,
      `file://${join(dir, `${name}.html`)}`,
    ],
    { stdio: 'ignore' },
  );
  process.stdout.write(`  wrote media/screenshots/${name}.png\n`);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gitlore-shots-'));
  const git = new GitService();
  const base = { nonce: 'shot', cspSource: '' };
  const editorFontFamily = 'Menlo';

  const commits = await git.getGraphCommits(REPO, 14);
  const [rawBranches, workingChanges] = await Promise.all([git.getBranches(REPO), git.getWorkingChanges(REPO)]);
  // This repo's own checked-out branch happens to be perfectly in sync with its upstream right
  // now (0 ahead, 0 behind) — git's `%(upstream:track)` renders that as an empty string, which is
  // indistinguishable from "no upstream at all", so the real ahead/behind would correctly render
  // no sync buttons at all. Synthesize plausible non-zero counts for the current branch here, for
  // this screenshot only, so the pull/push buttons the feature actually has are visible.
  const branches = rawBranches.map((b) => (b.isCurrent && !b.isRemote ? { ...b, ahead: 3, behind: 5 } : b));
  // This repo has no real stash sitting around right now — synthesize one against a real commit
  // sha, same reasoning as the ahead/behind counts above, so the stash chip is visible.
  const stashSha = commits[2]?.sha ?? '';
  const stashes = stashSha ? [{ index: 0, message: 'wip: experiment', baseSha: stashSha }] : [];
  writeFileSync(
    join(dir, 'commit-graph.html'),
    forBrowser(
      renderGraphHtml(
        { nodes: layoutGraph(commits), branches, workingChanges, stashes, selectedSha: commits[1]?.sha },
        { ...base, styleUris: [cssUrl('shared.css'), cssUrl('commitGraph.css')] },
      ),
    ),
  );
  shoot(dir, 'commit-graph', 1200, 400);

  // Same data, with the right-click context menu forced open — there's no real click to fire
  // against a static render, so this fakes the open state purely to document what it looks like.
  writeFileSync(
    join(dir, 'commit-graph-context-menu.html'),
    withOpenContextMenu(
      forBrowser(
        renderGraphHtml(
          { nodes: layoutGraph(commits), branches, workingChanges, stashes, selectedSha: commits[2]?.sha },
          { ...base, styleUris: [cssUrl('shared.css'), cssUrl('commitGraph.css')] },
        ),
      ),
      90,
      260,
    ),
  );
  shoot(dir, 'commit-graph-context-menu', 1200, 400);

  // A commit small enough to read, but with more than one file so the list is worth showing.
  const sha = commits.find((c) => c.filesChanged > 1 && c.filesChanged < 6)?.sha ?? commits[1]?.sha;
  if (!sha) {
    throw new Error('no suitable commit found for the commit-details shot');
  }
  const [commit, files, diff] = await Promise.all([
    git.getCommit(REPO, sha),
    git.getCommitFiles(REPO, sha),
    git.getCommitDiff(REPO, sha),
  ]);
  if (!commit) {
    throw new Error(`commit ${sha} not found`);
  }
  writeFileSync(
    join(dir, 'commit-details.html'),
    expandFirstFile(
      forBrowser(
        renderCommitDetailsHtml(
          { commit, files, diff },
          {
            ...base,
            styleUris: [cssUrl('shared.css'), cssUrl('commitDetails.css')],
            editorFontFamily,
            remote: { label: 'GitHub', url: `https://github.com/rajjadon/gitlore/commit/${sha}` },
          },
        ),
      ),
    ),
  );
  shoot(dir, 'commit-details', 680, 520);

  const [cmpBase, cmp] = ['HEAD~6', 'master'];
  const [aheadCommits, behindCommits, cmpFiles, cmpDiff] = await Promise.all([
    git.getCommitsBetween(REPO, cmpBase, cmp),
    git.getCommitsBetween(REPO, cmp, cmpBase),
    git.getFilesBetweenRefs(REPO, cmpBase, cmp),
    git.getDiffBetweenRefs(REPO, cmpBase, cmp),
  ]);
  writeFileSync(
    join(dir, 'branch-comparison.html'),
    forBrowser(
      renderBranchComparisonHtml(
        { base: cmpBase, compare: cmp, aheadCommits, behindCommits, files: cmpFiles, diff: cmpDiff, branches },
        {
          ...base,
          styleUris: [cssUrl('shared.css'), cssUrl('branchComparison.css')],
          editorFontFamily,
          createPr: { label: 'GitHub', url: `https://github.com/rajjadon/gitlore/compare/${cmpBase}...${cmp}` },
        },
      ),
    ),
  );
  shoot(dir, 'branch-comparison', 680, 330);

  const fileHistoryEntries = await git.getFileHistoryStats(join(REPO, 'CHANGELOG.md'), 20);
  writeFileSync(
    join(dir, 'visual-file-history.html'),
    forBrowser(
      renderFileHistoryHtml(
        { points: layoutFileHistory(fileHistoryEntries, new Date()) },
        { ...base, styleUris: [cssUrl('shared.css'), cssUrl('visualFileHistory.css')] },
      ),
    ),
  );
  shoot(dir, 'visual-file-history', 1100, 420);

  // A handful of this repo's own real commits, given a mixed set of rebase actions — real data,
  // synthetic *plan*, since there's no actual `git rebase -i` in progress to read one from.
  const rebaseLog = execFileSync('git', ['log', '-6', '--format=%h|%s'], { cwd: REPO }).toString().trim();
  const rebaseCommands = ['pick', 'squash', 'squash', 'pick', 'reword', 'fixup'];
  const rebaseEntries = rebaseLog.split('\n').map((line, i) => {
    const [sha, message] = line.split('|');
    const command = rebaseCommands[i] ?? 'pick';
    return { editable: true, command, sha: sha ?? '', message: message ?? '', raw: `${command} ${sha} ${message}` };
  });
  writeFileSync(
    join(dir, 'rebase-editor.html'),
    forBrowser(
      renderRebaseEditorHtml({ entries: rebaseEntries }, { ...base, styleUris: [cssUrl('shared.css'), cssUrl('rebaseEditor.css')] }),
    ),
  );
  shoot(dir, 'rebase-editor', 680, 360);

  // Launchpad pools PRs from real, authenticated remote hosts — nothing to render here without a
  // network call, so this is the one screenshot built from realistic sample data instead of this
  // repo's own history.
  const repo = (label: string): ForgeRepoRef => ({ host: 'github', identity: label, label });
  const pr = (overrides: Partial<PullRequestSummary> & Pick<PullRequestSummary, 'repo' | 'number' | 'title'>): PullRequestSummary => ({
    authorLogin: 'maya-chen',
    url: `https://github.com/${overrides.repo.identity}/pull/${overrides.number}`,
    isDraft: false,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    requestedReviewers: [],
    checkStatus: 'passing',
    reviewDecision: 'none',
    hasConflicts: false,
    ...overrides,
  });
  const acme = repo('acme/storefront');
  const mobile = repo('acme/mobile-app');
  writeFileSync(
    join(dir, 'launchpad.html'),
    forBrowser(
      renderLaunchpadHtml(
        {
          categorized: [
            {
              bucket: 'needsReview',
              pr: pr({ repo: acme, number: 482, title: 'Add checkout retry on payment timeout', requestedReviewers: ['you'], reviewDecision: 'reviewRequired' }),
            },
            {
              bucket: 'needsReview',
              pr: pr({ repo: mobile, number: 118, title: 'Migrate push notifications to new provider', authorLogin: 'sam-okafor', requestedReviewers: ['you'] }),
            },
            {
              bucket: 'readyToMerge',
              pr: pr({ repo: acme, number: 479, title: 'Cache product search results for 5 minutes', reviewDecision: 'approved' }),
            },
            {
              bucket: 'waiting',
              pr: pr({ repo: mobile, number: 121, title: 'Bump SDK to v14 and fix breaking API calls', checkStatus: 'pending', reviewDecision: 'reviewRequired', requestedReviewers: ['diego-alvarez'] }),
            },
            {
              bucket: 'blocked',
              pr: pr({ repo: acme, number: 475, title: 'Rework tax calculation for EU orders', checkStatus: 'failing', reviewDecision: 'changesRequested' }),
            },
            {
              bucket: 'drafts',
              pr: pr({ repo: acme, number: 485, title: 'WIP: dark mode for the storefront theme', isDraft: true }),
            },
            {
              bucket: 'merged',
              pr: pr({ repo: acme, number: 470, title: 'Debounce the search box instead of filtering on every keystroke', closedAt: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString() }),
            },
            {
              bucket: 'closed',
              pr: pr({ repo: mobile, number: 112, title: 'Try React Query for the order-history screen', authorLogin: 'sam-okafor', closedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() }),
            },
          ],
          errors: [],
          repoRows: [
            { key: acme.identity, label: 'acme/storefront' },
            { key: mobile.identity, label: 'acme/mobile-app' },
          ],
        },
        { ...base, styleUris: [cssUrl('shared.css'), cssUrl('launchpad.css')] },
      ),
    ),
  );
  shoot(dir, 'launchpad', 1850, 480);

  // Threads need a live PR to exist on, so — like the Launchpad board above — these are realistic
  // sample data rather than this repo's own history. Files/diff/title are real, reused from the
  // commit shot above (rather than an unrelated fictional title), so nothing on screen contradicts
  // the diff actually shown.
  const threads: ConversationThread[] = [
    { id: 't1', body: 'Worth a code comment on why this shrinks instead of truncating with an ellipsis?', authorLogin: 'sam-okafor', resolved: false, file: files[0]?.path, line: 12 },
    { id: 't2', body: 'Added one — the truncation was hiding the action buttons on long labels.', authorLogin: 'maya-chen', resolved: true, file: files[0]?.path, line: 12 },
    { id: 't3', body: 'LGTM, thanks for the quick turnaround.', authorLogin: 'diego-alvarez', resolved: false },
  ];
  writeFileSync(
    join(dir, 'pull-request-details.html'),
    expandFirstFile(
      forBrowser(
        renderPullRequestDetailsHtml(
          {
            pr: pr({ repo: acme, number: 482, title: commit.message, requestedReviewers: ['you'], reviewDecision: 'reviewRequired' }),
            files,
            diff,
            threads,
          },
          { ...base, styleUris: [cssUrl('shared.css'), cssUrl('pullRequestDetails.css')] },
        ),
      ),
    ),
  );
  shoot(dir, 'pull-request-details', 680, 620);
}

void main();
