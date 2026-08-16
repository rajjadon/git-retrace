import type { GitToolDefinition } from './gitTools';

export type ChatRole = 'user' | 'assistant';

export interface ChatToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  /** Plain text — present on a normal user question or a model's final text answer. */
  text?: string;
  /** Present on an assistant turn that invoked a tool (recorded so the model sees its own past calls). */
  toolCall?: ChatToolCall;
  /** Present on a user turn that carries a tool's result back to the model. */
  toolResult?: { callId: string; result: unknown };
}

export type ChatStreamPart =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; callId: string; name: string; args: Record<string, unknown> };

/** A model bound to a tool-calling chat request. Deliberately not `vscode.LanguageModelChat` — this stays vscode-free so the whole loop is unit-testable, same reasoning as `commitSummaryFlow.ts`'s `SummaryModel`. */
export interface ChatModel {
  sendChat(messages: ChatMessage[], tools: GitToolDefinition[], signal: AbortSignal): AsyncIterable<ChatStreamPart>;
}

export type ChatEvent =
  | { type: 'disabled' }
  | { type: 'noModel' }
  | { type: 'toolCall'; name: string; args: Record<string, unknown> }
  | { type: 'toolResult'; name: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface ChatFlowParams {
  enabled: boolean;
  selectModel: () => Promise<ChatModel | undefined>;
  messages: ChatMessage[];
  tools: GitToolDefinition[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxToolIterations: number;
  signal: AbortSignal;
}

/**
 * Pure orchestration for the chat panel: disabled check -> model selection -> (send the
 * conversation, stream text or tool-call parts -> execute any tool calls -> feed results back as
 * new turns) on repeat until the model answers in plain text or `maxToolIterations` is reached.
 * `ChatModel`/`AbortSignal` are vscode-free stand-ins for `vscode.LanguageModelChat`/
 * `vscode.CancellationToken`, so every branch — including the tool-calling ones no real
 * `vscode.lm` call in a test host can reach — is unit-testable with fakes.
 */
export async function* runChatFlow(params: ChatFlowParams): AsyncGenerator<ChatEvent> {
  const { enabled, selectModel, tools, executeTool, maxToolIterations, signal } = params;
  let messages = params.messages;

  if (!enabled) {
    yield { type: 'disabled' };
    return;
  }

  const model = await selectModel();
  if (!model) {
    yield { type: 'noModel' };
    return;
  }
  if (signal.aborted) {
    return;
  }

  let lastText = '';
  for (let iteration = 0; iteration < maxToolIterations; iteration++) {
    let fullText = '';
    const toolCalls: ChatToolCall[] = [];
    try {
      for await (const part of model.sendChat(messages, tools, signal)) {
        if (signal.aborted) {
          return;
        }
        if (part.kind === 'text') {
          fullText += part.text;
          yield { type: 'chunk', text: part.text };
        } else {
          toolCalls.push({ callId: part.callId, name: part.name, args: part.args });
          yield { type: 'toolCall', name: part.name, args: part.args };
        }
      }
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }

    if (signal.aborted) {
      return;
    }
    if (toolCalls.length === 0) {
      yield { type: 'done', text: fullText };
      return;
    }
    lastText = fullText;

    messages = [...messages, ...toolCalls.map((call): ChatMessage => ({ role: 'assistant', toolCall: call }))];
    for (const call of toolCalls) {
      if (signal.aborted) {
        return;
      }
      let result: unknown;
      try {
        result = await executeTool(call.name, call.args);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      messages = [...messages, { role: 'user', toolResult: { callId: call.callId, result } }];
      yield { type: 'toolResult', name: call.name };
    }
  }
  // maxToolIterations exhausted: yield whatever text the model produced on its last turn (often
  // empty — a turn that hit the cap was mid-tool-call) rather than looping forever.
  yield { type: 'done', text: lastText };
}
