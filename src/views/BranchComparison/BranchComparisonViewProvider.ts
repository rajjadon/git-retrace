import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderBranchComparisonHtml, type PrTarget } from './render';
import { openFileDiff } from '../../providers/GitContentProvider';
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

/** Docks branch comparison in the bottom panel (next to Commit Graph/Commit Details), instead of opening a new editor tab per comparison. */
export class BranchComparisonViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;
  private currentBase: string | undefined;
  private currentCompare: string | undefined;
  private currentFiles: FileChange[] = [];
  private currentPrUrl: string | undefined;
  // Guards against a superseded `load()` (e.g. a fast ref-picker change) overwriting a newer
  // one's rendered HTML with stale data once it resolves — same idiom as CommitGraphViewProvider.
  private loadGeneration = 0;

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
    // The view resolves the moment its tab is revealed, which can happen before "Compare Branches"
    // has ever been run — say what to do instead of showing an empty rectangle. Stays closed until
    // that command actually runs, rather than guessing a default comparison to show.
    if (!this.currentBase) {
      webviewView.webview.html = renderPlaceholderHtml('Compare two branches to see their diff here.', {
        nonce: createNonce(),
        cspSource: webviewView.webview.cspSource,
        styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.branchComparison)],
      });
    }
  }

  /**
   * Called by the "Compare Branches" command — reveals the panel tab and loads the given
   * comparison. Claims `currentBase`/`currentCompare` *before* `.focus()`, not after: focusing the
   * panel for the first time in a session synchronously triggers `resolveWebviewView`, which would
   * otherwise see no comparison claimed yet and flash the placeholder for a moment before `load()`
   * replaces it.
   */
  async show(filePath: string, base: string, compare: string): Promise<void> {
    this.currentBase = base;
    this.currentCompare = compare;
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
    const generation = ++this.loadGeneration;
    this.currentFilePath = filePath;
    this.currentBase = base;
    this.currentCompare = compare;
    this.view.title = `${base}...${compare}`;
    const styleUris = [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.branchComparison)];
    this.view.webview.html = renderPlaceholderHtml('Loading comparison…', {
      nonce: createNonce(),
      cspSource: this.view.webview.cspSource,
      styleUris,
      variant: 'loading',
    });

    try {
      const [aheadCommits, behindCommits, files, diff, branches, remoteInfo] = await Promise.all([
        this.git.getCommitsBetween(filePath, base, compare),
        this.git.getCommitsBetween(filePath, compare, base),
        this.git.getFilesBetweenRefs(filePath, base, compare),
        this.git.getDiffBetweenRefs(filePath, base, compare),
        this.git.getBranches(filePath),
        this.git.resolveRemoteInfo(filePath),
      ]);
      if (generation !== this.loadGeneration || !this.view) {
        return;
      }
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
          styleUris,
          editorFontFamily,
          createPr,
        },
      );
    } catch (err) {
      if (generation !== this.loadGeneration || !this.view) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = renderPlaceholderHtml(`GitLore: failed to load the comparison — ${message}`, {
        nonce: createNonce(),
        cspSource: this.view.webview.cspSource,
        styleUris,
        variant: 'error',
      });
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
