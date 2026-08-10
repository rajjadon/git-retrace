import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME } from './constants';
import { GitService } from './core/git/GitService';
import type { GitLogger } from './core/git/errors';
import { BlameSource } from './providers/BlameSource';
import { BlameDecorationProvider } from './providers/BlameDecorationProvider';
import { BlameHoverProvider } from './providers/BlameHoverProvider';
import { FileHistoryProvider } from './providers/FileHistoryProvider';
import { StatusBarProvider } from './providers/StatusBarProvider';
import { handleToggleBlameCommand } from './commands/blameCommands';
import { handleShowFileHistoryCommand, handleCopyShaCommand } from './commands/fileHistoryCommands';
import { handleShowCommitCommand } from './commands/commitCommands';
import { handleOpenGraphCommand } from './commands/graphCommands';
import { handleCompareBranchesCommand } from './commands/branchCommands';
import { CommitDetailsPanel } from './views/CommitDetails/CommitDetailsPanel';
import { CommitGraphPanel } from './views/CommitGraph/CommitGraphPanel';
import { BranchComparisonPanel } from './views/BranchComparison/BranchComparisonPanel';

/** Test-only introspection surface — accessed via `vscode.extensions.getExtension(id).exports` in integration tests. */
export interface GitSenseTestApi {
  blameProvider: BlameDecorationProvider;
  fileHistoryProvider: FileHistoryProvider;
  statusBarProvider: StatusBarProvider;
  git: GitService;
  getCommitDetailsHtml: () => string | undefined;
  getCommitGraphHtml: () => string | undefined;
  getBranchComparisonHtml: () => string | undefined;
}

export function activate(ctx: vscode.ExtensionContext): GitSenseTestApi {
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
  const blameSource = new BlameSource(git, logger);
  const blameProvider = new BlameDecorationProvider(blameSource);
  const hoverProvider = new BlameHoverProvider(blameSource, git);
  const fileHistoryProvider = new FileHistoryProvider(git);
  const statusBarProvider = new StatusBarProvider(blameProvider);

  ctx.subscriptions.push(
    blameSource,
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    handleToggleBlameCommand(blameProvider),
    handleShowFileHistoryCommand(fileHistoryProvider),
    handleCopyShaCommand(),
    handleShowCommitCommand(git, ctx.extensionUri),
    handleOpenGraphCommand(git, ctx.extensionUri),
    handleCompareBranchesCommand(git, ctx.extensionUri),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
  );
  output.appendLine('GitSense activated.');

  return {
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    git,
    getCommitDetailsHtml: () => CommitDetailsPanel.getCurrentHtmlForTest(),
    getCommitGraphHtml: () => CommitGraphPanel.getCurrentHtmlForTest(),
    getBranchComparisonHtml: () => BranchComparisonPanel.getCurrentHtmlForTest(),
  };
}

export function deactivate(): void {
  // Disposables are handled by ctx.subscriptions — nothing to do here.
}
