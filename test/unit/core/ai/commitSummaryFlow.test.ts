import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommitSummaryFlow, type SummaryEvent, type SummaryModel } from '../../../../src/core/ai/commitSummaryFlow';

async function collect(gen: AsyncGenerator<SummaryEvent>): Promise<SummaryEvent[]> {
  const events: SummaryEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function fakeModel(chunks: string[], failAfter?: number): SummaryModel {
  return {
    async *streamText(): AsyncGenerator<string, void, unknown> {
      for (const [i, chunk] of chunks.entries()) {
        if (failAfter !== undefined && i === failAfter) {
          throw new Error('model exploded');
        }
        yield chunk;
      }
    },
  };
}

test('runCommitSummaryFlow: disabled short-circuits before selecting a model', async () => {
  let selectCalls = 0;
  const events = await collect(
    runCommitSummaryFlow({
      enabled: false,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => {
        selectCalls++;
        return fakeModel(['x']);
      },
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'disabled' }]);
  assert.equal(selectCalls, 0);
});

test('runCommitSummaryFlow: a cache hit short-circuits before selecting a model', async () => {
  let selectCalls = 0;
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: 'previously generated summary',
      signal: new AbortController().signal,
      selectModel: async () => {
        selectCalls++;
        return fakeModel(['x']);
      },
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'cached', text: 'previously generated summary' }]);
  assert.equal(selectCalls, 0);
});

test('runCommitSummaryFlow: no model available yields noModel', async () => {
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => undefined,
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'noModel' }]);
});

test('runCommitSummaryFlow: streams chunks then yields done with the assembled text', async () => {
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => fakeModel(['Hello, ', 'world.']),
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'Hello, ' },
    { type: 'chunk', text: 'world.' },
    { type: 'done', text: 'Hello, world.' },
  ]);
});

test('runCommitSummaryFlow: a mid-stream failure yields the chunks seen so far, then error', async () => {
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => fakeModel(['partial ', ''], 1),
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [
    { type: 'chunk', text: 'partial ' },
    { type: 'error', message: 'model exploded' },
  ]);
});

test('runCommitSummaryFlow: aborting mid-stream ends the generator with no error event', async () => {
  const controller = new AbortController();
  const model: SummaryModel = {
    async *streamText(_prompt, signal): AsyncGenerator<string, void, unknown> {
      yield 'first ';
      controller.abort();
      if (signal.aborted) {
        throw new Error('should not be surfaced');
      }
      yield 'second';
    },
  };
  const events = await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: controller.signal,
      selectModel: async () => model,
      buildPrompt: () => 'prompt',
    }),
  );
  assert.deepEqual(events, [{ type: 'chunk', text: 'first ' }]);
});

test('runCommitSummaryFlow: calls buildPrompt lazily, only once a model is found', async () => {
  let buildCalls = 0;
  await collect(
    runCommitSummaryFlow({
      enabled: true,
      cached: undefined,
      signal: new AbortController().signal,
      selectModel: async () => undefined,
      buildPrompt: () => {
        buildCalls++;
        return 'prompt';
      },
    }),
  );
  assert.equal(buildCalls, 0);
});
