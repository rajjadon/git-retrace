import * as vscode from 'vscode';
import type { SummaryModel } from '../core/ai/commitSummaryFlow';
import type { GitLogger } from '../core/git/errors';
import type { ChatMessage, ChatModel, ChatStreamPart } from '../core/ai/chatFlow';
import type { GitToolDefinition } from '../core/ai/gitTools';

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

  async selectChatModel(modelFamily: string): Promise<ChatModel | undefined> {
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
      sendChat: (messages, tools, signal) => this.streamChat(model, messages, tools, signal),
    };
  }

  private async *streamChat(
    model: vscode.LanguageModelChat,
    messages: ChatMessage[],
    tools: GitToolDefinition[],
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamPart> {
    const tokenSource = new vscode.CancellationTokenSource();
    const onAbort = () => tokenSource.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      const vscodeMessages = messages.map(toVscodeChatMessage);
      const vscodeTools: vscode.LanguageModelChatTool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      const response = await model.sendRequest(vscodeMessages, { tools: vscodeTools }, tokenSource.token);
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          yield { kind: 'text', text: part.value };
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          yield { kind: 'toolCall', callId: part.callId, name: part.name, args: part.input as Record<string, unknown> };
        }
      }
    } catch (err) {
      this.logger.error('GitLore chat request failed', err);
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
      tokenSource.dispose();
    }
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

function toVscodeChatMessage(message: ChatMessage): vscode.LanguageModelChatMessage {
  if (message.toolCall) {
    return vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelToolCallPart(message.toolCall.callId, message.toolCall.name, message.toolCall.args),
    ]);
  }
  if (message.toolResult) {
    return vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelToolResultPart(message.toolResult.callId, [
        new vscode.LanguageModelTextPart(JSON.stringify(message.toolResult.result)),
      ]),
    ]);
  }
  return message.role === 'user'
    ? vscode.LanguageModelChatMessage.User(message.text ?? '')
    : vscode.LanguageModelChatMessage.Assistant(message.text ?? '');
}
