import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { BlameSource } from './BlameSource';
import { formatBlameHover } from '../utils/format';
import { resolveIssueLinking } from './issueLinking';
import { CONFIG, COMMANDS, DEFAULT_MAX_BLAME_FILE_SIZE } from '../constants';
import { buildLineExplanationKey, type LineExplanationState } from '../core/ai/lineExplanationKey';
import type { LruCache } from '../core/cache/LruCache';

export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly source: BlameSource,
    private readonly git: GitService,
    private readonly lineExplanationStore: LruCache<string, LineExplanationState>,
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
      const issueLinking = await resolveIssueLinking(this.git, doc.uri.fsPath);
      const lineContent = doc.lineAt(pos.line).text.slice(0, 500);

      let lineExplanation: LineExplanationState | undefined;
      if (!entry.isUncommitted) {
        const repoRoot = await this.git.getRepoRoot(doc.uri.fsPath);
        const key = buildLineExplanationKey(repoRoot, doc.uri.fsPath, entry.sha, lineContent);
        lineExplanation = this.lineExplanationStore.get(key);
      }

      const markdown = new vscode.MarkdownString(
        formatBlameHover(entry, diffStat, doc.uri.fsPath, lineContent, lineExplanation, undefined, issueLinking),
      );
      markdown.isTrusted = { enabledCommands: [COMMANDS.explainLine] };
      markdown.supportThemeIcons = true;
      return new vscode.Hover(markdown);
    } catch {
      // Blame failing on an unsaved/untracked file is expected — stay silent.
      return undefined;
    }
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
  }
}
