import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChatFlow, type ChatEvent, type ChatMessage, type ChatModel, type ChatStreamPart } from '../../../../src/core/ai/chatFlow';
import type { GitToolDefinition } from '../../../../src/core/ai/gitTools';

const TOOLS: GitToolDefinition[] = [
  { name: 'get_commit', description: 'd', inputSchema: { type: 'object', properties: {}, required: [] } },
];

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function textOnlyModel(parts: ChatStreamPart[]): ChatModel {
  return {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

function userMessage(text: string): ChatMessage {
  return { role: 'user', text };
}

test('runChatFlow: disabled short-circuits before selecting a model', async () => {
  let selectCalls = 0;
  const events = await collect(
    runChatFlow({
      enabled: false,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => {
        selectCalls++;
        return textOnlyModel([]);
      },
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [{ type: 'disabled' }]);
  assert.equal(selectCalls, 0);
});

test('runChatFlow: no model available yields noModel', async () => {
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => undefined,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [{ type: 'noModel' }]);
});

test('runChatFlow: a plain text answer streams chunks then done, with no tool calls', async () => {
  const model = textOnlyModel([
    { kind: 'text', text: 'Hello, ' },
    { kind: 'text', text: 'world.' },
  ]);
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'Hello, ' },
    { type: 'chunk', text: 'world.' },
    { type: 'done', text: 'Hello, world.' },
  ]);
});

test('runChatFlow: a single tool call executes and feeds the result back for a second turn', async () => {
  let call = 0;
  const model: ChatModel = {
    async *sendChat(messages): AsyncGenerator<ChatStreamPart, void, unknown> {
      call++;
      if (call === 1) {
        yield { kind: 'toolCall', callId: 't1', name: 'get_commit', args: { sha: 'abc' } };
      } else {
        // Second turn's messages must include the tool result from the first turn.
        const last = messages.at(-1);
        assert.equal(last?.toolResult?.callId, 't1');
        yield { kind: 'text', text: 'It was a fix.' };
      }
    },
  };
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('who wrote this?')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async (name, args) => {
        executed.push({ name, args });
        return { author: 'Raj' };
      },
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'toolCall', name: 'get_commit', args: { sha: 'abc' } },
    { type: 'toolResult', name: 'get_commit' },
    { type: 'chunk', text: 'It was a fix.' },
    { type: 'done', text: 'It was a fix.' },
  ]);
  assert.deepEqual(executed, [{ name: 'get_commit', args: { sha: 'abc' } }]);
});

test('runChatFlow: a tool that throws feeds an error result back instead of crashing the loop', async () => {
  let call = 0;
  const model: ChatModel = {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      call++;
      if (call === 1) {
        yield { kind: 'toolCall', callId: 't1', name: 'get_commit', args: {} };
      } else {
        yield { kind: 'text', text: "That commit doesn't exist." };
      }
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('who wrote this?')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => {
        throw new Error('bad sha');
      },
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'toolCall', name: 'get_commit', args: {} },
    { type: 'toolResult', name: 'get_commit' },
    { type: 'chunk', text: "That commit doesn't exist." },
    { type: 'done', text: "That commit doesn't exist." },
  ]);
});

test('runChatFlow: hitting maxToolIterations stops the loop and yields done instead of looping forever', async () => {
  const model: ChatModel = {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      // Always calls a tool, never answers in plain text — simulates a model stuck in a loop.
      yield { kind: 'toolCall', callId: 't1', name: 'get_commit', args: {} };
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => ({ ok: true }),
      maxToolIterations: 2,
    }),
  );
  const toolCallCount = events.filter((e) => e.type === 'toolCall').length;
  assert.equal(toolCallCount, 2);
  assert.deepEqual(events[events.length - 1], { type: 'done', text: '' });
});

test('runChatFlow: a mid-stream failure yields chunks seen so far, then error', async () => {
  const model: ChatModel = {
    async *sendChat(): AsyncGenerator<ChatStreamPart, void, unknown> {
      yield { kind: 'text', text: 'partial ' };
      throw new Error('model exploded');
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: new AbortController().signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'partial ' },
    { type: 'error', message: 'model exploded' },
  ]);
});

test('runChatFlow: aborting mid-stream ends the generator with no error event', async () => {
  const controller = new AbortController();
  const model: ChatModel = {
    async *sendChat(_messages, _tools, signal): AsyncGenerator<ChatStreamPart, void, unknown> {
      yield { kind: 'text', text: 'first ' };
      controller.abort();
      if (signal.aborted) {
        return;
      }
      yield { kind: 'text', text: 'second' };
    },
  };
  const events = await collect(
    runChatFlow({
      enabled: true,
      signal: controller.signal,
      messages: [userMessage('hi')],
      tools: TOOLS,
      selectModel: async () => model,
      executeTool: async () => undefined,
      maxToolIterations: 6,
    }),
  );
  assert.deepEqual(events, [{ type: 'chunk', text: 'first ' }]);
});
