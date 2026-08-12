import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME, SCHEMES, VIEWS } from './constants';
import { GitService } from './core/git/GitService';
import type { GitLogger } from './core/git/errors';
import { BlameSource } from './providers/BlameSource';
import { BlameDecorationProvider } from './providers/BlameDecorationProvider';
import { BlameHoverProvider } from './providers/BlameHoverProvider';
import { FileHistoryProvider } from './providers/FileHistoryProvider';
import { StatusBarProvider } from './providers/StatusBarProvider';
import { GitContentProvider } from './providers/GitContentProvider';
import { handleToggleBlameCommand } from './commands/blameCommands';
import { handleShowFileHistoryCommand, handleCopyShaCommand } from './commands/fileHistoryCommands';
import { handleShowCommitCommand } from './commands/commitCommands';
import { handleOpenGraphCommand } from './commands/graphCommands';
import { handleCompareBranchesCommand } from './commands/branchCommands';
import { handleExplainCommitCommand, handleExplainLineCommand } from './commands/aiCommands';
import { CommitDetailsViewProvider } from './views/CommitDetails/CommitDetailsViewProvider';
import { CommitGraphViewProvider } from './views/CommitGraph/CommitGraphViewProvider';
import { BranchComparisonViewProvider } from './views/BranchComparison/BranchComparisonViewProvider';
import { LanguageModelClient } from './ai/LanguageModelClient';

/** Test-only introspection surface — accessed via `vscode.extensions.getExtension(id).exports` in integration tests. */
export interface GitLoreTestApi {
  blameProvider: BlameDecorationProvider;
  fileHistoryProvider: FileHistoryProvider;
  statusBarProvider: StatusBarProvider;
  git: GitService;
  getCommitDetailsHtml: () => string | undefined;
  getCommitGraphHtml: () => string | undefined;
  getBranchComparisonHtml: () => string | undefined;
  explainCommit: () => Promise<void>;
  getAiSummaryMessagesForTest: () => unknown[];
  getCurrentLineContentForTest: () => string | undefined;
}

export function activate(ctx: vscode.ExtensionContext): GitLoreTestApi {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  ctx.subscriptions.push(output);

  const logger: GitLogger = {
    warn: (message) => output.appendLine(`[warn] ${message}`),
    error: (message, err) => output.appendLine(`[error] ${message}${err ? ` ${String(err)}` : ''}`),
  };
  // Constructing these does no I/O (no git process spawns until an editor event fires
  // one lazily), so there's nothing "heavy" to defer here and doing so would only
  // delay command registration past when activate() resolves, racing test/startup code.
  const git = new GitService(logger);
  const languageModelClient = new LanguageModelClient(logger);
  const blameSource = new BlameSource(git, logger);
  const blameProvider = new BlameDecorationProvider(blameSource);
  const hoverProvider = new BlameHoverProvider(blameSource, git);
  const fileHistoryProvider = new FileHistoryProvider(git);
  const statusBarProvider = new StatusBarProvider(blameProvider);
  const commitGraphViewProvider = new CommitGraphViewProvider(ctx.extensionUri, git);
  const commitDetailsViewProvider = new CommitDetailsViewProvider(ctx.extensionUri, git, languageModelClient, logger);
  const branchComparisonViewProvider = new BranchComparisonViewProvider(ctx.extensionUri, git);

  ctx.subscriptions.push(
    blameSource,
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    handleToggleBlameCommand(blameProvider),
    handleShowFileHistoryCommand(fileHistoryProvider),
    handleCopyShaCommand(),
    handleShowCommitCommand(commitDetailsViewProvider),
    handleOpenGraphCommand(commitGraphViewProvider),
    handleCompareBranchesCommand(git, branchComparisonViewProvider),
    handleExplainCommitCommand(commitDetailsViewProvider),
    handleExplainLineCommand(commitDetailsViewProvider),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
    // Backs the "Open changes" action in the commit-details and branch-comparison panels by
    // serving a file's contents at an arbitrary ref to the native diff editor.
    vscode.workspace.registerTextDocumentContentProvider(SCHEMES.gitContent, new GitContentProvider(git)),
    vscode.window.registerWebviewViewProvider(VIEWS.commitGraph, commitGraphViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.commitDetails, commitDetailsViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.branchComparison, branchComparisonViewProvider),
  );
  output.appendLine('GitLore activated.');

  return {
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    git,
    getCommitDetailsHtml: () => commitDetailsViewProvider.getCurrentHtmlForTest(),
    getCommitGraphHtml: () => commitGraphViewProvider.getCurrentHtmlForTest(),
    getBranchComparisonHtml: () => branchComparisonViewProvider.getCurrentHtmlForTest(),
    explainCommit: () => commitDetailsViewProvider.explainCommit(),
    getAiSummaryMessagesForTest: () => commitDetailsViewProvider.getAiSummaryMessagesForTest(),
    getCurrentLineContentForTest: () => commitDetailsViewProvider.getCurrentLineContentForTest(),
  };
}

export function deactivate(): void {
  // Disposables are handled by ctx.subscriptions — nothing to do here.
}
