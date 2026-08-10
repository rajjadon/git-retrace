import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { BlameSource } from './BlameSource';
import { formatBlameHover } from '../utils/format';
import { CONFIG } from '../constants';

const DEFAULT_MAX_BLAME_FILE_SIZE = 1_048_576;

export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly source: BlameSource,
    private readonly git: GitService,
  ) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    if (doc.uri.scheme !== 'file' || !this.getConfig<boolean>(CONFIG.blameEnabled, true)) {
      return undefined;
    }

    const maxSize = this.getConfig<number>(CONFIG.maxBlameFileSize, DEFAULT_MAX_BLAME_FILE_SIZE);
    if (Buffer.byteLength(doc.getText(), 'utf8') > maxSize) {
      return undefined;
    }

    try {
      const ignoreWhitespace = this.getConfig<boolean>(CONFIG.blameIgnoreWhitespace, true);
      const lines = await this.source.getBlameLines(doc.uri.fsPath, { ignoreWhitespace });
      const entry = lines?.find((l) => l.line === pos.line);
      if (!entry) {
        return undefined;
      }

      const diffStat = entry.isUncommitted ? null : await this.git.getFileDiffStat(doc.uri.fsPath, entry.sha);
      return new vscode.Hover(new vscode.MarkdownString(formatBlameHover(entry, diffStat)));
    } catch {
      // Blame failing on an unsaved/untracked file is expected — stay silent.
      return undefined;
    }
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
  }
}
