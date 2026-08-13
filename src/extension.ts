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
import { StaleCodeLensProvider } from './providers/CodeLensProvider';
import { OwnershipDecorationProvider } from './providers/OwnershipDecorationProvider';
import { FullFileBlameDecorationProvider } from './providers/FullFileBlameDecorationProvider';
import { handleToggleBlameCommand, handleStepLineHistoryCommand, handleToggleFullFileBlameCommand } from './commands/blameCommands';
import { handleShowFileHistoryCommand, handleCopyShaCommand } from './commands/fileHistoryCommands';
import { handleShowCommitCommand } from './commands/commitCommands';
import { handleOpenGraphCommand } from './commands/graphCommands';
import { handleShowVisualFileHistoryCommand } from './commands/visualFileHistoryCommands';
import { handleCompareBranchesCommand } from './commands/branchCommands';
import { handleExplainCommitCommand, handleExplainLineCommand } from './commands/aiCommands';
import { handleShowFileOwnershipCommand, buildOwnershipQuickPickItems } from './commands/ownershipCommands';
import { handleRebaseInteractivelyCommand } from './commands/rebaseCommands';
import {
  handleCheckoutBranchCommand,
  handleCompareBranchCommand,
  handleOpenRemoteCommand,
  handleApplyStashCommand,
  handleDropStashCommand,
} from './commands/explorerCommands';
import { CommitDetailsViewProvider } from './views/CommitDetails/CommitDetailsViewProvider';
import { CommitGraphViewProvider, resolveRepoContextPath } from './views/CommitGraph/CommitGraphViewProvider';
import { BranchComparisonViewProvider } from './views/BranchComparison/BranchComparisonViewProvider';
import { VisualFileHistoryViewProvider } from './views/VisualFileHistory/VisualFileHistoryViewProvider';
import { RebaseEditorProvider } from './views/RebaseEditor/RebaseEditorProvider';
import { RepoExplorerProvider } from './providers/RepoExplorerProvider';
import { LanguageModelClient } from './ai/LanguageModelClient';
import { LineExplanationService } from './ai/LineExplanationService';
import { LruCache } from './core/cache/LruCache';
import type { LineExplanationState } from './core/ai/lineExplanationKey';

/** Test-only introspection surface — accessed via `vscode.extensions.getExtension(id).exports` in integration tests. */
export interface GitLoreTestApi {
  blameProvider: BlameDecorationProvider;
  fileHistoryProvider: FileHistoryProvider;
  statusBarProvider: StatusBarProvider;
  ownershipProvider: OwnershipDecorationProvider;
  fullFileBlameProvider: FullFileBlameDecorationProvider;
  git: GitService;
  getCommitDetailsHtml: () => string | undefined;
  getCommitGraphHtml: () => string | undefined;
  getBranchComparisonHtml: () => string | undefined;
  getVisualFileHistoryHtml: () => string | undefined;
  getRebaseEditorHtml: () => string | undefined;
  repoExplorerProvider: RepoExplorerProvider;
  explainCommit: () => Promise<void>;
  getAiSummaryMessagesForTest: () => unknown[];
  getLineExplanationStateForTest: (filePath: string, sha: string, lineContent: string) => Promise<LineExplanationState | undefined>;
  getOwnershipItemsForTest: (filePath: string) => Promise<vscode.QuickPickItem[] | null>;
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
  const lineExplanationStore = new LruCache<string, LineExplanationState>(50);
  const lineExplanationService = new LineExplanationService(git, languageModelClient, logger, lineExplanationStore);
  const lineHistoryNavStore = new LruCache<string, number>(50);
  const blameSource = new BlameSource(git, logger);
  const blameProvider = new BlameDecorationProvider(blameSource);
  const hoverProvider = new BlameHoverProvider(blameSource, git, lineExplanationStore, lineHistoryNavStore);
  const staleCodeLensProvider = new StaleCodeLensProvider(blameSource);
  const ownershipProvider = new OwnershipDecorationProvider(blameSource);
  const fullFileBlameProvider = new FullFileBlameDecorationProvider(blameSource);
  const fileHistoryProvider = new FileHistoryProvider(git);
  const statusBarProvider = new StatusBarProvider(blameProvider);
  const commitGraphViewProvider = new CommitGraphViewProvider(ctx.extensionUri, git);
  const commitDetailsViewProvider = new CommitDetailsViewProvider(ctx.extensionUri, git, languageModelClient, logger);
  const branchComparisonViewProvider = new BranchComparisonViewProvider(ctx.extensionUri, git);
  const visualFileHistoryViewProvider = new VisualFileHistoryViewProvider(ctx.extensionUri, git);
  const rebaseEditorProvider = new RebaseEditorProvider(ctx.extensionUri);
  const repoExplorerProvider = new RepoExplorerProvider(git);

  ctx.subscriptions.push(
    blameSource,
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    staleCodeLensProvider,
    ownershipProvider,
    fullFileBlameProvider,
    handleToggleBlameCommand(blameProvider),
    handleToggleFullFileBlameCommand(fullFileBlameProvider),
    handleStepLineHistoryCommand(git, lineHistoryNavStore),
    handleShowFileHistoryCommand(fileHistoryProvider),
    handleCopyShaCommand(),
    handleShowCommitCommand(commitDetailsViewProvider),
    handleOpenGraphCommand(commitGraphViewProvider),
    handleShowVisualFileHistoryCommand(visualFileHistoryViewProvider),
    handleCompareBranchesCommand(git, branchComparisonViewProvider),
    handleExplainCommitCommand(commitDetailsViewProvider),
    handleExplainLineCommand(lineExplanationService),
    handleShowFileOwnershipCommand(blameSource),
    handleRebaseInteractivelyCommand(git),
    repoExplorerProvider,
    handleCheckoutBranchCommand(git, repoExplorerProvider),
    handleCompareBranchCommand(git),
    handleOpenRemoteCommand(),
    handleApplyStashCommand(git, repoExplorerProvider),
    handleDropStashCommand(git, repoExplorerProvider),
    repoExplorerProvider.watchActiveEditor(),
    vscode.window.registerTreeDataProvider(VIEWS.explorer, repoExplorerProvider),
    vscode.window.registerCustomEditorProvider(VIEWS.rebaseEditor, rebaseEditorProvider),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, staleCodeLensProvider),
    // Backs the "Open changes" action in the commit-details and branch-comparison panels by
    // serving a file's contents at an arbitrary ref to the native diff editor.
    vscode.workspace.registerTextDocumentContentProvider(SCHEMES.gitContent, new GitContentProvider(git)),
    vscode.window.registerWebviewViewProvider(VIEWS.commitGraph, commitGraphViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.commitDetails, commitDetailsViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.branchComparison, branchComparisonViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.visualFileHistory, visualFileHistoryViewProvider),
  );
  const initialRepoPath = resolveRepoContextPath();
  if (initialRepoPath) {
    // Deferred: six git subprocesses spawned synchronously during activation would compete with
    // the first blame/hover lookups a just-opened editor is waiting on. `setImmediate` lets
    // those run first.
    setImmediate(() => void repoExplorerProvider.refresh(initialRepoPath));
  }

  output.appendLine('GitLore activated.');

  return {
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    ownershipProvider,
    fullFileBlameProvider,
    git,
    getCommitDetailsHtml: () => commitDetailsViewProvider.getCurrentHtmlForTest(),
    getCommitGraphHtml: () => commitGraphViewProvider.getCurrentHtmlForTest(),
    getBranchComparisonHtml: () => branchComparisonViewProvider.getCurrentHtmlForTest(),
    getVisualFileHistoryHtml: () => visualFileHistoryViewProvider.getCurrentHtmlForTest(),
    getRebaseEditorHtml: () => rebaseEditorProvider.getCurrentHtmlForTest(),
    repoExplorerProvider,
    explainCommit: () => commitDetailsViewProvider.explainCommit(),
    getAiSummaryMessagesForTest: () => commitDetailsViewProvider.getAiSummaryMessagesForTest(),
    getLineExplanationStateForTest: (filePath, sha, lineContent) =>
      lineExplanationService.getState(filePath, sha, lineContent),
    getOwnershipItemsForTest: (filePath: string) => buildOwnershipQuickPickItems(blameSource, filePath),
  };
}

export function deactivate(): void {
  // Disposables are handled by ctx.subscriptions — nothing to do here.
}
