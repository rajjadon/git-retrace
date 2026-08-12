import type { CommitDetail } from '../git/types';

const TRUNCATION_MARKER = '[...truncated]';

/** Builds the prompt for "Explain Commit with AI". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildCommitSummaryPrompt(commit: CommitDetail, diff: string, maxDiffChars: number): string {
  const body = diff.length > maxDiffChars ? diff.slice(0, maxDiffChars) + TRUNCATION_MARKER : diff;
  return `You are summarizing a single git commit for a developer skimming their repository's history.

Commit message:
${commit.body}

Diff:
${body}

Write a plain-English summary of what changed and why, in 2-4 sentences. Do not repeat the commit message verbatim. If the diff was truncated, base your summary only on what's shown.`;
}

/** Builds the prompt for "Explain This Line's History". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildLineExplanationPrompt(commit: CommitDetail, diff: string, lineContent: string, maxDiffChars: number): string {
  const body = diff.length > maxDiffChars ? diff.slice(0, maxDiffChars) + TRUNCATION_MARKER : diff;
  return `You are explaining why a specific line of code exists, to a developer reading it in their editor.

The line in question:
${lineContent}

It was last changed in this commit. Commit message:
${commit.body}

Diff:
${body}

Find the line above within the diff and explain why it was introduced or changed, in 2-4 sentences. Do not repeat the commit message verbatim. If the diff was truncated and the line isn't visible in what's shown, say so instead of guessing.`;
}
