import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderBranchComparisonHtml, type PrTarget } from './render';
import { escapeHtml } from '../escapeHtml';
import { openFileDiff } from '../../providers/GitContentProvider';
import { pickDefaultRefs } from '../../utils/branchDefaults';
import { resolveRepoContextPath } from '../CommitGraph/CommitGraphViewProvider';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { COMMANDS, MEDIA, VIEWS } from '../../constants';
import { buildCreatePrUrl, remoteHostLabel } from '../../utils/remoteLinks';
import type { FileChange } from '../../core/git/types';

/** Above this, "Open all changes" confirms first — opening dozens of diff editors in one click is more likely a misclick than the intent. */
const OPEN_ALL_CONFIRM_THRESHOLD = 20;

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function shellHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none';" /></head><body>${bodyHtml}</body></html>`;
}

/** Docks branch comparison in the bottom panel (next to Commit Graph/Commit Details), instead of opening a new editor tab per comparison. */
export class BranchComparisonViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;
  private currentBase: string | undefined;
  private currentCompare: string | undefined;
  private currentFiles: FileChange[] = [];
  private currentPrUrl: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly git: GitService,
  ) {}

  /** Test-only introspection seam — VS Code's public API doesn't expose a webview's rendered HTML. */
  getCurrentHtmlForTest(): string | undefined {
    return this.view?.webview.html;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    void this.loadDefault();
  }

  /**
   * Loads a sensible comparison as soon as the tab is revealed — the checked-out branch against its
   * upstream — so the panel is useful without running a command first, matching how Commit Graph
   * already behaves. The user can retarget both refs in the view's own ref bar.
   */
  private async loadDefault(): Promise<void> {
    if (!this.view || this.currentBase) {
      return;
    }
    const filePath = resolveRepoContextPath();
    if (!filePath) {
      return;
    }
    const [branches, currentBranch] = await Promise.all([
      this.git.getBranches(filePath),
      this.git.getCurrentBranch(filePath),
    ]);
    // An explicit `show(base, compare)` can land while those git calls are in flight; it wins, and
    // this must not overwrite it with the default pair afterwards.
    if (this.currentBase) {
      return;
    }
    const refs = pickDefaultRefs(branches, currentBranch);
    if (!refs) {
      this.view.webview.html = renderPlaceholderHtml('This repo has only one ref — nothing to compare yet.', {
        nonce: createNonce(),
        cspSource: this.view.webview.cspSource,
        styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.branchComparison)],
      });
      return;
    }
    await this.load(filePath, refs.base, refs.compare);
  }

  /** Called by the "Compare Branches" command — reveals the panel tab and loads the given comparison. */
  async show(filePath: string, base: string, compare: string): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.branchComparison}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, base, compare);
  }

  private mediaUri(name: string): string {
    return this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  private async load(filePath: string, base: string, compare: string): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentFilePath = filePath;
    this.currentBase = base;
    this.currentCompare = compare;
    this.view.title = `${base}...${compare}`;
    this.view.webview.html = shellHtml('<p>Loading comparison…</p>');

    try {
      const [aheadCommits, behindCommits, files, diff, branches, remoteInfo] = await Promise.all([
        this.git.getCommitsBetween(filePath, base, compare),
        this.git.getCommitsBetween(filePath, compare, base),
        this.git.getFilesBetweenRefs(filePath, base, compare),
        this.git.getDiffBetweenRefs(filePath, base, compare),
        this.git.getBranches(filePath),
        this.git.resolveRemoteInfo(filePath),
      ]);
      this.currentFiles = files;

      // Only offer "Create PR" when we know that host's compare-URL shape — a button that
      // reliably 404s is worse than no button.
      const prUrl = remoteInfo ? buildCreatePrUrl(remoteInfo, base, compare) : null;
      const createPr: PrTarget | null = remoteInfo && prUrl ? { label: remoteHostLabel(remoteInfo), url: prUrl } : null;
      this.currentPrUrl = prUrl ?? undefined;

      const editorFontFamily = vscode.workspace
        .getConfiguration('editor')
        .get<string>('fontFamily', 'Menlo, Monaco, monospace');

      this.view.webview.html = renderBranchComparisonHtml(
        { base, compare, aheadCommits, behindCommits, files, diff, branches },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.branchComparison)],
          editorFontFamily,
          createPr,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitLore: failed to load the comparison — ${escapeHtml(message)}</p>`);
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, sha, base, compare, path } = message as {
      type?: unknown;
      sha?: unknown;
      base?: unknown;
      compare?: unknown;
      path?: unknown;
    };
    const filePath = this.currentFilePath;

    if (type === 'openCommit' && typeof sha === 'string' && filePath) {
      await vscode.commands.executeCommand(COMMANDS.showCommit, filePath, sha);
      return;
    }
    if (type === 'setRefs' && typeof base === 'string' && typeof compare === 'string' && filePath) {
      await this.load(filePath, base, compare);
      return;
    }
    if (type === 'refresh' && filePath && this.currentBase && this.currentCompare) {
      await this.load(filePath, this.currentBase, this.currentCompare);
      return;
    }
    if (type === 'openFileDiff' && typeof path === 'string' && filePath && this.currentBase && this.currentCompare) {
      // Diff against the merge base, not against `base` itself, so the editor agrees with the
      // `base...compare` diff rendered inline — on diverged branches those differ.
      const mergeBase = await this.git.getMergeBase(filePath, this.currentBase, this.currentCompare);
      await openFileDiff({
        repoPath: filePath,
        path,
        beforeRef: mergeBase ?? this.currentBase,
        afterRef: this.currentCompare,
        label: `${this.currentBase}...${this.currentCompare}`,
      });
      return;
    }
    if (type === 'createPr' && this.currentPrUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentPrUrl));
      return;
    }
    if (type === 'openAllChanges' && filePath && this.currentBase && this.currentCompare) {
      await this.openAllChanges(filePath, this.currentBase, this.currentCompare);
    }
  }

  private async openAllChanges(filePath: string, base: string, compare: string): Promise<void> {
    const files = this.currentFiles.filter((f) => !f.binary);
    if (files.length === 0) {
      return;
    }
    if (files.length > OPEN_ALL_CONFIRM_THRESHOLD) {
      const confirmed = await vscode.window.showWarningMessage(
        `Open ${files.length} diff editors? This opens one tab per changed file.`,
        { modal: true },
        'Open All',
      );
      if (confirmed !== 'Open All') {
        return;
      }
    }
    // Same merge-base rule as a single "Open changes" click — diffs against `base` itself would
    // also surface base's own commits as differences on diverged branches.
    const mergeBase = await this.git.getMergeBase(filePath, base, compare);
    for (const file of files) {
      await openFileDiff({
        repoPath: filePath,
        path: file.path,
        beforeRef: mergeBase ?? base,
        afterRef: compare,
        label: `${base}...${compare}`,
      });
    }
  }
}
