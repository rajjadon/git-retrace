import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { LanguageModelClient } from './LanguageModelClient';
import type { GitLogger } from '../core/git/errors';
import { runCommitSummaryFlow } from '../core/ai/commitSummaryFlow';
import { buildCommitMessagePrompt } from '../core/ai/prompts';
import { CONFIG } from '../constants';

export type CommitMessageEvent =
  | { type: 'disabled' }
  | { type: 'noStagedChanges' }
  | { type: 'noModel' }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

/**
 * Generates a commit message from the staged diff. No panel of its own — the caller streams
 * `chunk`/`done` text straight into the built-in Git extension's commit-message box, since
 * that's already the right place for this text to live.
 */
export class CommitMessageService {
  constructor(
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  async *generate(filePath: string, signal: AbortSignal): AsyncGenerator<CommitMessageEvent> {
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);

    // Checked before the diff is even read: a disabled feature shouldn't spawn a git subprocess
    // just to throw its output away, same reasoning as LineExplanationService.
    if (!enabled) {
      yield { type: 'disabled' };
      return;
    }

    const diff = await this.git.getStagedDiff(filePath);
    if (!diff.trim()) {
      yield { type: 'noStagedChanges' };
      return;
    }

    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const flow = runCommitSummaryFlow({
      enabled,
      cached: undefined,
      signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildCommitMessagePrompt(diff, maxDiffChars),
    });

    for await (const event of flow) {
      if (signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
        case 'cached':
          // Unreachable here: `enabled` is already true and `cached` is always undefined above.
          break;
        case 'noModel':
          yield { type: 'noModel' };
          return;
        case 'chunk':
          yield { type: 'chunk', text: event.text };
          break;
        case 'done':
          yield { type: 'done', text: event.text };
          return;
        case 'error':
          this.logger.error('AI commit message generation failed', event.message);
          yield { type: 'error', message: event.message };
          return;
      }
    }
  }
}
