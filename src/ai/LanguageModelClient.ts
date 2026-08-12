import * as vscode from 'vscode';
import type { SummaryModel } from '../core/ai/commitSummaryFlow';
import type { GitLogger } from '../core/git/errors';

/**
 * Thin adapter over `vscode.lm` — the only file that touches the Language Model API directly.
 * Not unit-tested in isolation: it does real I/O against whatever model the user has registered,
 * the same way `GitService` wraps `simple-git` without a unit test of its own. Its behavior is
 * exercised through `CommitDetailsViewProvider`'s integration tests, and the orchestration logic
 * around it is fully covered by `commitSummaryFlow.test.ts`.
 */
export class LanguageModelClient {
  constructor(private readonly logger: GitLogger) {}

  async selectModel(modelFamily: string): Promise<SummaryModel | undefined> {
    // vscode.lm doesn't exist on editor builds older than where the Language Model API landed —
    // GitLore's declared engines.vscode floor predates it, so this checks rather than assumes.
    if (typeof vscode.lm === 'undefined') {
      return undefined;
    }
    let models = await vscode.lm.selectChatModels({ family: modelFamily });
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels();
    }
    const model = models[0];
    if (!model) {
      return undefined;
    }
    return {
      streamText: (prompt, signal) => this.streamText(model, prompt, signal),
    };
  }

  private async *streamText(model: vscode.LanguageModelChat, prompt: string, signal: AbortSignal): AsyncIterable<string> {
    const tokenSource = new vscode.CancellationTokenSource();
    const onAbort = () => tokenSource.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, tokenSource.token);
      for await (const chunk of response.text) {
        yield chunk;
      }
    } catch (err) {
      this.logger.error('AI commit summary request failed', err);
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
      tokenSource.dispose();
    }
  }
}
