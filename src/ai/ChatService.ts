import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import type { LanguageModelClient } from './LanguageModelClient';
import type { GitLogger } from '../core/git/errors';
import { runChatFlow, type ChatEvent, type ChatMessage } from '../core/ai/chatFlow';
import { GIT_TOOL_DEFINITIONS, executeGitTool } from '../core/ai/gitTools';
import { CONFIG } from '../constants';

/** Orchestrates the chat panel's single active conversation. One conversation per panel — `newChat()` clears it; no persisted multi-session history. */
export class ChatService {
  private messages: ChatMessage[] = [];

  constructor(
    private readonly git: GitService,
    private readonly languageModelClient: LanguageModelClient,
    private readonly logger: GitLogger,
  ) {}

  newChat(): void {
    this.messages = [];
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  async *send(filePath: string, userText: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    this.messages = [...this.messages, { role: 'user', text: userText }];

    const config = vscode.workspace.getConfiguration(CONFIG.section);
    const enabled = config.get<boolean>(CONFIG.aiEnabled, false);
    const modelFamily = config.get<string>(CONFIG.aiModelFamily, 'gpt-4o');
    const maxDiffChars = config.get<number>(CONFIG.aiMaxDiffChars, 8000);
    const maxToolIterations = config.get<number>(CONFIG.aiMaxToolIterations, 6);

    const flow = runChatFlow({
      enabled,
      signal,
      messages: this.messages,
      tools: GIT_TOOL_DEFINITIONS,
      selectModel: () => this.languageModelClient.selectChatModel(modelFamily),
      executeTool: (name, args) => executeGitTool(this.git, filePath, name, args, maxDiffChars),
      maxToolIterations,
    });

    for await (const event of flow) {
      if (signal.aborted) {
        return;
      }
      if (event.type === 'error') {
        this.logger.error('GitLore chat failed', event.message);
      }
      if (event.type === 'done') {
        this.messages = [...this.messages, { role: 'assistant', text: event.text }];
      }
      yield event;
    }
  }
}
