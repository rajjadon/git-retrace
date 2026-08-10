import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderBranchComparisonHtml } from './render';
import { escapeHtml } from '../escapeHtml';
import { openFileDiff } from '../../providers/GitContentProvider';
import { waitForWebviewView } from '../waitForWebviewView';
import { COMMANDS, VIEWS } from '../../constants';

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

/** Docks branch comparison in the bottom panel (next to Commit Graph/Commit Details), matching GitLens's panel layout, instead of opening a new editor tab per comparison. */
export class BranchComparisonViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;
  private currentBase: string | undefined;
  private currentCompare: string | undefined;

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
      const [aheadCommits, behindCommits, files, diff, branches] = await Promise.all([
        this.git.getCommitsBetween(filePath, base, compare),
        this.git.getCommitsBetween(filePath, compare, base),
        this.git.getFilesBetweenRefs(filePath, base, compare),
        this.git.getDiffBetweenRefs(filePath, base, compare),
        this.git.getBranches(filePath),
      ]);

      const editorFontFamily = vscode.workspace
        .getConfiguration('editor')
        .get<string>('fontFamily', 'Menlo, Monaco, monospace');

      this.view.webview.html = renderBranchComparisonHtml(
        { base, compare, aheadCommits, behindCommits, files, diff, branches },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris: [this.mediaUri('shared.css'), this.mediaUri('branchComparison.css')],
          editorFontFamily,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitSense: failed to load the comparison — ${escapeHtml(message)}</p>`);
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
    }
  }
}
