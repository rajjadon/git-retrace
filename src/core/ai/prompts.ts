import type { CommitDetail } from '../git/types';
import type { PullRequestSummary } from '../forge/types';
import type { Commit } from '../git/types';
import type { ConversationThread } from '../forge/types';

const TRUNCATION_MARKER = '[...truncated]';

/** Truncates `text` to `maxChars`, appending a marker when it does. Shared by every prompt builder below and by `core/ai/gitTools.ts`'s diff-shaped tool results. */
export function truncateForModel(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + TRUNCATION_MARKER : text;
}

/** Builds the prompt for "Explain Commit with AI". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildCommitSummaryPrompt(commit: CommitDetail, diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  return `You are summarizing a single git commit for a developer skimming their repository's history.

Commit message:
${commit.body}

Diff:
${body}

Write a plain-English summary of what changed and why, in 2-4 sentences. Do not repeat the commit message verbatim. If the diff was truncated, base your summary only on what's shown.`;
}

/** Builds the prompt for "Explain This Line's History". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildLineExplanationPrompt(commit: CommitDetail, diff: string, lineContent: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  return `You are explaining why a specific line of code exists, to a developer reading it in their editor.

The line in question:
${lineContent}

It was last changed in this commit. Commit message:
${commit.body}

Diff:
${body}

Find the line above within the diff and explain why it was introduced or changed, in 2-4 sentences. Do not repeat the commit message verbatim. If the diff was truncated and the line isn't visible in what's shown, say so instead of guessing.`;
}

/** Builds the prompt for "Generate Commit Message with AI". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildCommitMessagePrompt(diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  return `You are writing a git commit message for the staged changes below.

Diff:
${body}

Write a commit message: a short imperative subject line (under 72 characters, no trailing period), and if the change needs more context, a blank line followed by a brief body explaining what changed and why. Do not wrap the message in quotes or a code block. If the diff was truncated, base the message only on what's shown.`;
}

/** Builds the prompt for "Explain this PR". Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildPrExplanationPrompt(pr: PullRequestSummary, diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  return `You are summarizing a pull request for a developer deciding whether to review it.

Title: ${pr.title}

Diff:
${body}

Write a plain-English summary of what this PR changes and why, in 2-4 sentences, followed by one sentence calling out the riskiest area to focus a review on. Do not repeat the title verbatim. If the diff was truncated, base your summary only on what's shown.`;
}

/** Builds the prompt for Branch Comparison's AI summary. Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildBranchCompareSummaryPrompt(base: string, compare: string, diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  return `You are summarizing the difference between two git branches for a developer deciding whether to merge one into the other.

Comparing ${base}...${compare}.

Diff:
${body}

Write a plain-English summary of what ${compare} changes relative to ${base}, in 2-4 sentences. If the diff was truncated, base your summary only on what's shown.`;
}

/** Builds the prompt for NL changelog generation. Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildChangelogPrompt(from: string, to: string, commits: Commit[], diff: string, maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  const subjects = commits.map((c) => `- ${c.message}`).join('\n');
  return `You are writing a human-readable changelog entry summarizing everything that changed between ${from} and ${to}.

Commit subjects:
${subjects || '(no commits)'}

Diff:
${body}

Write a changelog in Markdown, grouped into "Added", "Changed", and "Fixed" sections (omit any section with nothing to say). Use one bullet per notable change, written for an end user, not a developer. Do not invent changes not supported by the commits or diff above. If the diff was truncated, rely more heavily on the commit subjects for anything not visible in the shown diff.`;
}

/** Builds the prompt for a draft PR review comment. Pure — no I/O, no vscode import, unit-tested in isolation. */
export function buildPrReviewDraftPrompt(pr: PullRequestSummary, diff: string, threads: ConversationThread[], maxDiffChars: number): string {
  const body = truncateForModel(diff, maxDiffChars);
  const existingThreads = threads.length > 0
    ? threads.map((t) => `- ${t.authorLogin}: ${t.body}`).join('\n')
    : '(no existing review conversations)';
  return `You are drafting one top-level review comment for a pull request, to be edited by a human reviewer before posting — never post this yourself.

Title: ${pr.title}

Existing review conversations:
${existingThreads}

Diff:
${body}

Write one draft comment (2-5 sentences) raising the most useful question or concern a careful reviewer would, that isn't already covered by an existing conversation above. If the diff was truncated, base it only on what's shown. Do not include a greeting or sign-off.`;
}
