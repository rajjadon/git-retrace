import * as vscode from 'vscode';
import { GitService } from '../../core/git/GitService';
import { renderCommitDetailsHtml, type RemoteTarget } from './render';
import { escapeHtml } from '../escapeHtml';
import { resolveIssueLinking } from '../../providers/issueLinking';
import { openFileDiff } from '../../providers/GitContentProvider';
import { buildCommitUrl, remoteHostLabel } from '../../utils/remoteLinks';
import { renderPlaceholderHtml } from '../placeholder';
import { waitForWebviewView } from '../waitForWebviewView';
import { COMMANDS, MEDIA, VIEWS } from '../../constants';
import type { CommitDetail } from '../../core/git/types';

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

/** Docks commit details in the bottom panel (next to Commit Graph), matching GitLens's panel layout, instead of opening a new editor tab per commit. */
export class CommitDetailsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentFilePath: string | undefined;
  private currentCommit: CommitDetail | undefined;
  private currentRemoteUrl: string | undefined;

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
    // The view resolves the moment its tab is revealed, which is usually before any commit has
    // been picked. Say what to do instead of showing an empty rectangle.
    if (!this.currentCommit) {
      webviewView.webview.html = renderPlaceholderHtml('Select a commit in the Commit Graph to see its details.', {
        nonce: createNonce(),
        cspSource: webviewView.webview.cspSource,
        styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.commitDetails)],
      });
    }
  }

  /** Called by the "Show Commit Details" command — reveals the panel tab and loads the given commit. */
  async show(filePath: string, sha: string): Promise<void> {
    await vscode.commands.executeCommand(`${VIEWS.commitDetails}.focus`);
    await waitForWebviewView(() => this.view);
    await this.load(filePath, sha);
  }

  private mediaUri(name: string): string {
    return this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString() ?? '';
  }

  private async load(filePath: string, sha: string): Promise<void> {
    if (!this.view) {
      return;
    }
    this.currentFilePath = filePath;
    this.view.title = `Commit ${sha.slice(0, 7)}`;
    this.view.webview.html = shellHtml('<p>Loading commit…</p>');

    try {
      const [commit, files, diff, issueLinking, remoteInfo] = await Promise.all([
        this.git.getCommit(filePath, sha),
        this.git.getCommitFiles(filePath, sha),
        this.git.getCommitDiff(filePath, sha),
        resolveIssueLinking(this.git, filePath),
        this.git.resolveRemoteInfo(filePath),
      ]);
      if (!commit) {
        this.view.webview.html = shellHtml('<p>GitSense: commit not found.</p>');
        return;
      }
      this.currentCommit = commit;

      // Only offer "Open on <host>" when we know that host's commit-URL shape — a button that
      // reliably 404s is worse than no button.
      const url = remoteInfo ? buildCommitUrl(remoteInfo, commit.sha) : null;
      const remote: RemoteTarget | null = remoteInfo && url ? { label: remoteHostLabel(remoteInfo), url } : null;
      this.currentRemoteUrl = url ?? undefined;

      const editorFontFamily = vscode.workspace
        .getConfiguration('editor')
        .get<string>('fontFamily', 'Menlo, Monaco, monospace');

      this.view.webview.html = renderCommitDetailsHtml(
        { commit, files, diff },
        {
          nonce: createNonce(),
          cspSource: this.view.webview.cspSource,
          styleUris: [this.mediaUri(MEDIA.shared), this.mediaUri(MEDIA.commitDetails)],
          editorFontFamily,
          issueLinking,
          remote,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.view.webview.html = shellHtml(`<p>GitSense: failed to load commit — ${escapeHtml(message)}</p>`);
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const { type, path } = message as { type?: unknown; path?: unknown };
    const commit = this.currentCommit;

    if (type === 'copySha' && commit) {
      await vscode.commands.executeCommand(COMMANDS.copySha, commit.sha);
      return;
    }
    if (type === 'copyMessage' && commit) {
      await vscode.env.clipboard.writeText(commit.body);
      void vscode.window.setStatusBarMessage('GitSense: commit message copied', 2000);
      return;
    }
    if (type === 'openRemote' && this.currentRemoteUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentRemoteUrl));
      return;
    }
    if (type === 'openFileDiff' && typeof path === 'string' && commit && this.currentFilePath) {
      // `<sha>^` doesn't resolve for a root commit; GitService returns an empty left-hand side
      // for that, which is exactly right — every line reads as added.
      await openFileDiff({
        repoPath: this.currentFilePath,
        path,
        beforeRef: `${commit.sha}^`,
        afterRef: commit.sha,
        label: commit.shortSha,
      });
    }
  }
}
