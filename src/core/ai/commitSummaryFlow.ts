/** A model bound to a prompt-streaming call. Deliberately not `vscode.LanguageModelChat` — this stays vscode-free so the whole flow is unit-testable. */
export interface SummaryModel {
  streamText(prompt: string, signal: AbortSignal): AsyncIterable<string>;
}

export type SummaryEvent =
  | { type: 'disabled' }
  | { type: 'cached'; text: string }
  | { type: 'noModel' }
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface CommitSummaryFlowParams {
  enabled: boolean;
  cached: string | undefined;
  selectModel: () => Promise<SummaryModel | undefined>;
  buildPrompt: () => string;
  signal: AbortSignal;
}

/**
 * Pure orchestration for "Explain Commit with AI": disabled check -> cache check -> model
 * selection -> prompt build -> streaming -> done/error. `AbortSignal` and `SummaryModel` are
 * generic stand-ins for `vscode.CancellationToken`/`vscode.LanguageModelChat` specifically so
 * every branch here — including ones no real vscode.lm call in a test host can reach — is
 * unit-testable with fakes.
 */
export async function* runCommitSummaryFlow(params: CommitSummaryFlowParams): AsyncGenerator<SummaryEvent> {
  const { enabled, cached, selectModel, buildPrompt, signal } = params;

  if (!enabled) {
    yield { type: 'disabled' };
    return;
  }
  if (cached !== undefined) {
    yield { type: 'cached', text: cached };
    return;
  }

  const model = await selectModel();
  if (!model) {
    yield { type: 'noModel' };
    return;
  }
  // selectModel() can block on VS Code's model-consent UI for seconds; the caller may have
  // aborted (e.g. the user switched to a different commit) by the time it resolves. Bail before
  // building the prompt or starting a stream nobody wants — an already-aborted AbortSignal never
  // re-fires its 'abort' event, so the listener LanguageModelClient.streamText() attaches would
  // never run and a full model request would go out anyway.
  if (signal.aborted) {
    return;
  }

  const prompt = buildPrompt();
  let fullText = '';
  try {
    for await (const chunk of model.streamText(prompt, signal)) {
      if (signal.aborted) {
        return;
      }
      fullText += chunk;
      yield { type: 'chunk', text: chunk };
    }
  } catch (err) {
    if (signal.aborted) {
      return;
    }
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield { type: 'done', text: fullText };
}
