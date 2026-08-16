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
import { CoChangeCodeLensProvider } from './providers/CoChangeCodeLensProvider';
import { OwnershipDecorationProvider } from './providers/OwnershipDecorationProvider';
import { FullFileBlameDecorationProvider } from './providers/FullFileBlameDecorationProvider';
import { warnIfGitUnavailable } from './providers/GitAvailabilityCheck';
import { handleToggleBlameCommand, handleStepLineHistoryCommand, handleToggleFullFileBlameCommand } from './commands/blameCommands';
import {
  handleShowFileHistoryCommand,
  handleCopyShaCommand,
  handleLoadMoreFileHistoryCommand,
} from './commands/fileHistoryCommands';
import { handleShowCommitCommand } from './commands/commitCommands';
import { handleOpenGraphCommand } from './commands/graphCommands';
import { handleShowVisualFileHistoryCommand } from './commands/visualFileHistoryCommands';
import { handleCompareBranchesCommand } from './commands/branchCommands';
import {
  handleExplainCommitCommand,
  handleExplainLineCommand,
  handleGenerateCommitMessageCommand,
  handleExplainPullRequestCommand,
  handleSummarizeBranchComparisonCommand,
  handleGenerateChangelogCommand,
  handleDraftPrReviewCommand,
} from './commands/aiCommands';
import { ChatService } from './ai/ChatService';
import { ChatViewProvider } from './views/Chat/ChatViewProvider';
import {
  handleOpenChatCommand,
  handleAskAboutFileCommand,
  handleAskAboutCommitCommand,
  handleAskAboutLineCommand,
  handleAskAboutPullRequestCommand,
} from './commands/chatCommands';
import { handleShowFileOwnershipCommand, buildOwnershipQuickPickItems } from './commands/ownershipCommands';
import { handleShowCoChangedFilesCommand } from './commands/coChangeCommands';
import { handleRebaseInteractivelyCommand } from './commands/rebaseCommands';
import {
  handleCheckoutBranchCommand,
  handleCompareBranchCommand,
  handleMergeBranchCommand,
  handleRebaseOntoBranchCommand,
  handleOpenRemoteCommand,
  handleApplyStashCommand,
  handleDropStashCommand,
} from './commands/explorerCommands';
import { CommitDetailsViewProvider } from './views/CommitDetails/CommitDetailsViewProvider';
import { CommitGraphViewProvider, resolveRepoContextPath } from './views/CommitGraph/CommitGraphViewProvider';
import { BranchComparisonViewProvider } from './views/BranchComparison/BranchComparisonViewProvider';
import { VisualFileHistoryViewProvider } from './views/VisualFileHistory/VisualFileHistoryViewProvider';
import { RebaseEditorProvider } from './views/RebaseEditor/RebaseEditorProvider';
import { LaunchpadViewProvider } from './views/Launchpad/LaunchpadViewProvider';
import { handleOpenLaunchpadCommand } from './commands/launchpadCommands';
import { PullRequestDetailsViewProvider } from './views/PullRequestDetails/PullRequestDetailsViewProvider';
import { handleShowPullRequestCommand } from './commands/pullRequestCommands';
import { RepoExplorerProvider } from './providers/RepoExplorerProvider';
import { LanguageModelClient } from './ai/LanguageModelClient';
import { LineExplanationService } from './ai/LineExplanationService';
import { CommitMessageService } from './ai/CommitMessageService';
import { ChangelogService } from './ai/ChangelogService';
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
  loadMoreCommitGraph: () => Promise<void>;
  commitGraphActionForTest: (action: string, sha: string) => Promise<void>;
  commitGraphStashActionForTest: (action: 'apply' | 'drop', index: number) => Promise<void>;
  getBranchComparisonHtml: () => string | undefined;
  getVisualFileHistoryHtml: () => string | undefined;
  getRebaseEditorHtml: () => string | undefined;
  getLaunchpadHtml: () => string | undefined;
  getPullRequestDetailsHtml: () => string | undefined;
  repoExplorerProvider: RepoExplorerProvider;
  branchComparisonViewProvider: BranchComparisonViewProvider;
  launchpadProvider: LaunchpadViewProvider;
  pullRequestDetailsProvider: PullRequestDetailsViewProvider;
  explainCommit: () => Promise<void>;
  getAiSummaryMessagesForTest: () => unknown[];
  explainPr: () => Promise<void>;
  getPrAiSummaryMessagesForTest: () => unknown[];
  draftReview: () => Promise<void>;
  summarizeBranchComparison: () => Promise<void>;
  getBranchComparisonAiSummaryMessagesForTest: () => unknown[];
  getLineExplanationStateForTest: (filePath: string, sha: string, lineContent: string) => Promise<LineExplanationState | undefined>;
  getOwnershipItemsForTest: (filePath: string) => Promise<vscode.QuickPickItem[] | null>;
  getChatHtml: () => string | undefined;
  chatProvider: ChatViewProvider;
  sendChatForTest: (text: string) => Promise<void>;
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
  const commitMessageService = new CommitMessageService(git, languageModelClient, logger);
  const changelogService = new ChangelogService(git, languageModelClient, logger);
  const lineHistoryNavStore = new LruCache<string, number>(50);
  const blameSource = new BlameSource(git, logger);
  const blameProvider = new BlameDecorationProvider(blameSource);
  const hoverProvider = new BlameHoverProvider(blameSource, git, lineExplanationStore, lineHistoryNavStore);
  const staleCodeLensProvider = new StaleCodeLensProvider(blameSource);
  const coChangeCodeLensProvider = new CoChangeCodeLensProvider(git, blameSource);
  const ownershipProvider = new OwnershipDecorationProvider(blameSource);
  const fullFileBlameProvider = new FullFileBlameDecorationProvider(blameSource);
  const fileHistoryProvider = new FileHistoryProvider(git);
  const statusBarProvider = new StatusBarProvider(blameProvider);
  const commitGraphViewProvider = new CommitGraphViewProvider(ctx.extensionUri, git, blameSource);
  const commitDetailsViewProvider = new CommitDetailsViewProvider(ctx.extensionUri, git, languageModelClient, logger);
  const branchComparisonViewProvider = new BranchComparisonViewProvider(ctx.extensionUri, ctx, git, languageModelClient, logger);
  const visualFileHistoryViewProvider = new VisualFileHistoryViewProvider(ctx.extensionUri, git);
  const rebaseEditorProvider = new RebaseEditorProvider(ctx.extensionUri);
  const launchpadProvider = new LaunchpadViewProvider(ctx.extensionUri, ctx, git, logger);
  const pullRequestDetailsViewProvider = new PullRequestDetailsViewProvider(ctx.extensionUri, languageModelClient, logger);
  const chatService = new ChatService(git, languageModelClient, logger);
  const chatViewProvider = new ChatViewProvider(ctx.extensionUri, chatService);
  const repoExplorerProvider = new RepoExplorerProvider(git);

  ctx.subscriptions.push(
    blameSource,
    blameProvider,
    fileHistoryProvider,
    statusBarProvider,
    staleCodeLensProvider,
    coChangeCodeLensProvider,
    ownershipProvider,
    fullFileBlameProvider,
    commitGraphViewProvider,
    handleToggleBlameCommand(blameProvider),
    handleToggleFullFileBlameCommand(fullFileBlameProvider),
    handleStepLineHistoryCommand(git, lineHistoryNavStore),
    handleShowFileHistoryCommand(fileHistoryProvider),
    handleLoadMoreFileHistoryCommand(fileHistoryProvider),
    handleCopyShaCommand(),
    handleShowCommitCommand(commitDetailsViewProvider),
    handleOpenGraphCommand(commitGraphViewProvider),
    handleShowVisualFileHistoryCommand(visualFileHistoryViewProvider),
    handleCompareBranchesCommand(git, branchComparisonViewProvider),
    handleSummarizeBranchComparisonCommand(branchComparisonViewProvider),
    handleExplainCommitCommand(commitDetailsViewProvider),
    handleExplainLineCommand(lineExplanationService),
    handleGenerateCommitMessageCommand(commitMessageService, git),
    handleGenerateChangelogCommand(changelogService, git),
    handleShowFileOwnershipCommand(blameSource),
    handleShowCoChangedFilesCommand(),
    handleRebaseInteractivelyCommand(git),
    launchpadProvider,
    handleOpenLaunchpadCommand(launchpadProvider),
    handleShowPullRequestCommand(pullRequestDetailsViewProvider, launchpadProvider),
    handleExplainPullRequestCommand(pullRequestDetailsViewProvider),
    handleDraftPrReviewCommand(pullRequestDetailsViewProvider),
    repoExplorerProvider,
    handleCheckoutBranchCommand(git, repoExplorerProvider),
    handleCompareBranchCommand(git),
    handleMergeBranchCommand(git),
    handleRebaseOntoBranchCommand(git),
    handleOpenRemoteCommand(),
    handleApplyStashCommand(git, repoExplorerProvider),
    handleDropStashCommand(git, repoExplorerProvider),
    repoExplorerProvider.watchActiveEditor(),
    vscode.window.registerTreeDataProvider(VIEWS.explorer, repoExplorerProvider),
    vscode.window.registerCustomEditorProvider(VIEWS.rebaseEditor, rebaseEditorProvider),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, staleCodeLensProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, coChangeCodeLensProvider),
    // Backs the "Open changes" action in the commit-details and branch-comparison panels by
    // serving a file's contents at an arbitrary ref to the native diff editor.
    vscode.workspace.registerTextDocumentContentProvider(SCHEMES.gitContent, new GitContentProvider(git)),
    vscode.window.registerWebviewViewProvider(VIEWS.commitGraph, commitGraphViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.commitDetails, commitDetailsViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.branchComparison, branchComparisonViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.visualFileHistory, visualFileHistoryViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.pullRequestDetails, pullRequestDetailsViewProvider),
    handleOpenChatCommand(chatViewProvider),
    handleAskAboutFileCommand(chatViewProvider),
    handleAskAboutCommitCommand(commitDetailsViewProvider, chatViewProvider),
    handleAskAboutLineCommand(chatViewProvider),
    handleAskAboutPullRequestCommand(pullRequestDetailsViewProvider, chatViewProvider),
    vscode.window.registerWebviewViewProvider(VIEWS.chat, chatViewProvider),
  );
  const initialRepoPath = resolveRepoContextPath();
  if (initialRepoPath) {
    // Deferred: six git subprocesses spawned synchronously during activation would compete with
    // the first blame/hover lookups a just-opened editor is waiting on. `setImmediate` lets
    // those run first.
    setImmediate(() => void repoExplorerProvider.refresh(initialRepoPath));
  }
  setImmediate(() => void warnIfGitUnavailable(ctx, git));

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
    loadMoreCommitGraph: () => commitGraphViewProvider.loadMore(),
    commitGraphActionForTest: (action, sha) => commitGraphViewProvider.handleCommitActionForTest(action, sha),
    commitGraphStashActionForTest: (action, index) => commitGraphViewProvider.handleStashActionForTest(action, index),
    getBranchComparisonHtml: () => branchComparisonViewProvider.getCurrentHtmlForTest(),
    getVisualFileHistoryHtml: () => visualFileHistoryViewProvider.getCurrentHtmlForTest(),
    getRebaseEditorHtml: () => rebaseEditorProvider.getCurrentHtmlForTest(),
    getLaunchpadHtml: () => launchpadProvider.getCurrentHtmlForTest(),
    getPullRequestDetailsHtml: () => pullRequestDetailsViewProvider.getCurrentHtmlForTest(),
    repoExplorerProvider,
    branchComparisonViewProvider,
    launchpadProvider,
    pullRequestDetailsProvider: pullRequestDetailsViewProvider,
    explainCommit: () => commitDetailsViewProvider.explainCommit(),
    getAiSummaryMessagesForTest: () => commitDetailsViewProvider.getAiSummaryMessagesForTest(),
    explainPr: () => pullRequestDetailsViewProvider.explainPr(),
    getPrAiSummaryMessagesForTest: () => pullRequestDetailsViewProvider.getAiSummaryMessagesForTest(),
    draftReview: () => pullRequestDetailsViewProvider.draftReview(),
    summarizeBranchComparison: () => branchComparisonViewProvider.summarizeComparison(),
    getBranchComparisonAiSummaryMessagesForTest: () => branchComparisonViewProvider.getAiSummaryMessagesForTest(),
    getLineExplanationStateForTest: (filePath, sha, lineContent) =>
      lineExplanationService.getState(filePath, sha, lineContent),
    getOwnershipItemsForTest: (filePath: string) => buildOwnershipQuickPickItems(blameSource, filePath),
    getChatHtml: () => chatViewProvider.getCurrentHtmlForTest(),
    chatProvider: chatViewProvider,
    sendChatForTest: (text: string) => chatViewProvider.sendForTest(text),
  };
}

export function deactivate(): void {
  // Disposables are handled by ctx.subscriptions — nothing to do here.
}
