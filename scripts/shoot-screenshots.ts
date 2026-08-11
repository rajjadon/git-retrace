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
 * `media/screenshots/inline-blame.png` cannot be produced here at all: an editor decoration is not
 * a webview, so no HTML exists to render. That one has to be captured by hand.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GitService } from '../src/core/git/GitService';
import { layoutGraph } from '../src/core/graph/layout';
import { renderGraphHtml } from '../src/views/CommitGraph/render';
import { renderCommitDetailsHtml } from '../src/views/CommitDetails/render';
import { renderBranchComparisonHtml } from '../src/views/BranchComparison/render';

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
--vscode-diffEditor-removedTextBackground:rgba(255,70,70,0.16);}`;

/** A webview CSP blocks `file://` stylesheets. Irrelevant to a screenshot, so swap it for the theme. */
function forBrowser(html: string): string {
  return html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<style>${THEME}</style>`);
}

/** Expands the first file so the diff gutter — the thing worth showing — is actually visible. */
function expandFirstFile(html: string): string {
  return html.replace('<details class="file"', '<details class="file" open');
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
  const dir = mkdtempSync(join(tmpdir(), 'git-retrace-shots-'));
  const git = new GitService();
  const base = { nonce: 'shot', cspSource: '' };
  const editorFontFamily = 'Menlo';

  const commits = await git.getGraphCommits(REPO, 14);
  const [branches, workingChanges] = await Promise.all([git.getBranches(REPO), git.getWorkingChanges(REPO)]);
  writeFileSync(
    join(dir, 'commit-graph.html'),
    forBrowser(
      renderGraphHtml(
        { nodes: layoutGraph(commits), branches, workingChanges, selectedSha: commits[1]?.sha },
        { ...base, styleUri: cssUrl('commitGraph.css') },
      ),
    ),
  );
  shoot(dir, 'commit-graph', 1200, 400);

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
            remote: { label: 'GitHub', url: `https://github.com/rajjadon/git-retrace/commit/${sha}` },
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
        { ...base, styleUris: [cssUrl('shared.css'), cssUrl('branchComparison.css')], editorFontFamily },
      ),
    ),
  );
  shoot(dir, 'branch-comparison', 680, 330);
}

void main();
