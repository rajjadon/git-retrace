import * as vscode from 'vscode';
import type { GitService } from '../core/git/GitService';
import type { BlameSource } from './BlameSource';
import { computeCoChangedFiles } from '../core/git/coChange';
import { toRepoRelativePath } from '../utils/path';
import { CONFIG, COMMANDS, DEFAULT_MAX_BLAME_FILE_SIZE } from '../constants';
import type { CommitFileList } from '../core/git/types';

const DEFAULT_MAX_HISTORY_ITEMS = 200;

/**
 * Flags files that frequently change alongside the open one — a "logical coupling" signal from
 * `git log`, not the code itself. One lens per file, mirroring the stale-code lens's approach.
 */
export class CoChangeCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
  private readonly invalidateDisposable: vscode.Disposable;
  private readonly configDisposable: vscode.Disposable;
  // One repo-wide log fetch serves every file in that repo — keyed by repo root, not by file.
  // Cleared on the same HEAD/refs invalidation BlameSource already watches for.
  private readonly commitsByRepoRoot = new Map<string, CommitFileList[]>();

  constructor(
    private readonly git: GitService,
    private readonly source: BlameSource,
  ) {
    this.invalidateDisposable = this.source.onInvalidate((repoRoot) => {
      this.commitsByRepoRoot.delete(repoRoot);
      this.onDidChangeCodeLensesEmitter.fire();
    });
    this.configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG.section)) {
        this.onDidChangeCodeLensesEmitter.fire();
      }
    });
  }

  dispose(): void {
    this.invalidateDisposable.dispose();
    this.configDisposable.dispose();
    this.onDidChangeCodeLensesEmitter.dispose();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    if (!config.get<boolean>(CONFIG.coChangeEnabled, true) || document.uri.scheme !== 'file') {
      return [];
    }

    const maxSize = config.get<number>(CONFIG.maxBlameFileSize, DEFAULT_MAX_BLAME_FILE_SIZE);
    if (Buffer.byteLength(document.getText(), 'utf8') > maxSize) {
      return [];
    }

    const filePath = document.uri.fsPath;
    const repoRoot = await this.git.getRepoRoot(filePath);
    if (!repoRoot) {
      return [];
    }
    this.source.watchHeadFor(repoRoot);

    let commits = this.commitsByRepoRoot.get(repoRoot);
    if (!commits) {
      const maxCount = config.get<number>(CONFIG.maxHistoryItems, DEFAULT_MAX_HISTORY_ITEMS);
      commits = await this.git.getCoChangeCommits(filePath, maxCount);
      this.commitsByRepoRoot.set(repoRoot, commits);
    }

    const relativePath = toRepoRelativePath(repoRoot, filePath);
    const coChanged = computeCoChangedFiles(commits, relativePath);
    if (coChanged.length === 0) {
      return [];
    }

    const names = coChanged.map((f) => f.path.split('/').pop());
    const shown = names.slice(0, 2).join(', ');
    const more = names.length > 2 ? ` (+${names.length - 2})` : '';
    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: `🔗 Often changes with: ${shown}${more}`,
        command: COMMANDS.showCoChangedFiles,
        arguments: [repoRoot, coChanged],
      }),
    ];
  }
}
