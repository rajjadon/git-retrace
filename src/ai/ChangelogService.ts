import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { LanguageModelClient } from './LanguageModelClient';
import type { GitLogger } from '../core/git/errors';
import { runCommitSummaryFlow } from '../core/ai/commitSummaryFlow';
import { buildChangelogPrompt } from '../core/ai/prompts';
import { CONFIG } from '../constants';

export type ChangelogEvent =
  | { type: 'disabled' }
  | { type: 'noCommits' }
  | { type: 'noModel' }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

/** Generates a Markdown changelog between two refs. No panel of its own — the caller streams the result into an untitled Markdown document, the simplest surface for a one-off block of text with copy/save already built in via the editor itself. */
export class ChangelogService {
  constructor(
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  async *generate(filePath: string, from: string, to: string, signal: AbortSignal): AsyncGenerator<ChangelogEvent> {
    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);

    if (!enabled) {
      yield { type: 'disabled' };
      return;
    }

    const commits = await this.git.getCommitsBetween(filePath, from, to);
    if (commits.length === 0) {
      yield { type: 'noCommits' };
      return;
    }

    const diff = await this.git.getDiffBetweenRefs(filePath, from, to);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);

    const flow = runCommitSummaryFlow({
      enabled,
      cached: undefined,
      signal,
      selectModel: () => this.languageModelClient.selectModel(modelFamily),
      buildPrompt: () => buildChangelogPrompt(from, to, commits, diff, maxDiffChars),
    });

    for await (const event of flow) {
      if (signal.aborted) {
        return;
      }
      switch (event.type) {
        case 'disabled':
        case 'cached':
          // Unreachable: `enabled` is already true and `cached` is always undefined above.
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
          this.logger.error('Changelog generation failed', event.message);
          yield { type: 'error', message: event.message };
          return;
      }
    }
  }
}
