import * as vscode from 'vscode';
import { MERGE_STRATEGIES_BY_HOST, type MergeStrategy, type PullRequestSummary } from '../core/forge/types';

/** Labels/descriptions for the merge-strategy QuickPick, one per `MergeStrategy` — filtered per host via `MERGE_STRATEGIES_BY_HOST` before it's ever shown, so a host never offers a strategy it can't actually perform. Shared by Launchpad's card Merge action and Pull Request Details' Merge action — the same product surface twice, so the same picker. */
const STRATEGY_QUICK_PICK_LABELS: Record<MergeStrategy, { label: string; description: string }> = {
  merge: { label: 'Merge', description: 'Create a merge commit' },
  squash: { label: 'Squash and merge', description: 'Combine all commits into one' },
  rebase: { label: 'Rebase and merge', description: 'Replay commits onto the base — no merge commit' },
};

export async function pickMergeStrategy(pr: PullRequestSummary): Promise<MergeStrategy | undefined> {
  const items = MERGE_STRATEGIES_BY_HOST[pr.repo.host].map((strategy) => ({ ...STRATEGY_QUICK_PICK_LABELS[strategy], strategy }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'How should this pull request be merged?' });
  return picked?.strategy;
}
