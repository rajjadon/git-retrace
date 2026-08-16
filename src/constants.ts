/** Single source of truth for command IDs, config keys, view IDs, and context keys. No magic strings elsewhere. */

export const OUTPUT_CHANNEL_NAME = 'GitLore';

/** Shared by Commit Graph's and Launchpad's push/pull buttons, so both reuse the same terminal instead of spawning duplicates. */
export const SYNC_TERMINAL_NAME = 'GitLore: Git Sync';

/** Default for `gitLore.maxBlameFileSize` — shared so every blame-consuming provider agrees on the fallback. */
export const DEFAULT_MAX_BLAME_FILE_SIZE = 1_048_576;

export const COMMANDS = {
  toggleBlame: 'gitLore.toggleBlame',
  showFileHistory: 'gitLore.showFileHistory',
  loadMoreFileHistory: 'gitLore.loadMoreFileHistory',
  showCommit: 'gitLore.showCommit',
  copySha: 'gitLore.copySha',
  openGraph: 'gitLore.openGraph',
  showVisualFileHistory: 'gitLore.showVisualFileHistory',
  compareBranches: 'gitLore.compareBranches',
  explainCommit: 'gitLore.explainCommit',
  explainLine: 'gitLore.explainLine',
  generateCommitMessage: 'gitLore.generateCommitMessage',
  showFileOwnership: 'gitLore.showFileOwnership',
  rebaseInteractively: 'gitLore.rebaseInteractively',
  checkoutBranch: 'gitLore.checkoutBranch',
  compareBranchFromExplorer: 'gitLore.compareBranchFromExplorer',
  openRemote: 'gitLore.openRemote',
  applyStash: 'gitLore.applyStash',
  dropStash: 'gitLore.dropStash',
  stepLineHistory: 'gitLore.stepLineHistory',
  toggleFullFileBlame: 'gitLore.toggleFullFileBlame',
  openLaunchpad: 'gitLore.openLaunchpad',
  showPullRequest: 'gitLore.showPullRequest',
  openChat: 'gitLore.openChat',
  askAboutFile: 'gitLore.askAboutFile',
  askAboutCommit: 'gitLore.askAboutCommit',
  askAboutLine: 'gitLore.askAboutLine',
  askAboutPullRequest: 'gitLore.askAboutPullRequest',
  explainPullRequest: 'gitLore.explainPullRequest',
  summarizeBranchComparison: 'gitLore.summarizeBranchComparison',
  generateChangelog: 'gitLore.generateChangelog',
  draftPrReview: 'gitLore.draftPrReview',
  mergeBranchFromExplorer: 'gitLore.mergeBranchFromExplorer',
  rebaseOntoBranchFromExplorer: 'gitLore.rebaseOntoBranchFromExplorer',
} as const;

export const CONFIG = {
  section: 'gitLore',
  blameEnabled: 'blame.enabled',
  blameFormat: 'blame.format',
  blameHighlightCurrentLine: 'blame.highlightCurrentLine',
  blameIgnoreWhitespace: 'blame.ignoreWhitespace',
  maxHistoryItems: 'maxHistoryItems',
  maxBlameFileSize: 'maxBlameFileSize',
  maxGraphItems: 'maxGraphItems',
  staleCodeEnabled: 'staleCode.enabled',
  staleThresholdDays: 'staleThresholdDays',
  ownershipEnabled: 'ownership.enabled',
  fullFileBlameEnabled: 'fullFileBlame.enabled',
  issueLinkingEnabled: 'issueLinking.enabled',
  issueLinkingPattern: 'issueLinking.pattern',
  issueLinkingUrlTemplate: 'issueLinking.urlTemplate',
  aiEnabled: 'ai.enabled',
  aiModelFamily: 'ai.modelFamily',
  aiMaxDiffChars: 'ai.maxDiffChars',
  aiMaxToolIterations: 'ai.maxToolIterations',
  rebaseEditorEnabled: 'rebaseEditor.enabled',
  launchpadEnabled: 'launchpad.enabled',
  launchpadCustomHosts: 'launchpad.customHosts',
} as const;

export const VIEWS = {
  fileHistory: 'gitLore.fileHistory',
  commitDetails: 'gitLore.commitDetails',
  commitGraph: 'gitLore.commitGraph',
  branchComparison: 'gitLore.branchComparison',
  visualFileHistory: 'gitLore.visualFileHistory',
  rebaseEditor: 'gitLore.rebaseEditor',
  explorer: 'gitLore.explorer',
  pullRequestDetails: 'gitLore.pullRequestDetails',
  chat: 'gitLore.chat',
  /** Not registered via `contributes.views` — created imperatively with `createWebviewPanel` (a full editor-area tab, like Rebase Editor, not a docked panel), so this id is only ever used internally. */
  launchpad: 'gitLore.launchpad',
} as const;

/**
 * Webview asset filenames under `media/`. Single source of truth: a stylesheet referenced by a
 * name that no longer exists fails silently — the webview renders unstyled rather than erroring —
 * so these are constants with an existence test behind them (`test/unit/media.test.ts`).
 */
export const MEDIA = {
  /** Section header, changed-file rows and inline diff, shared by Commit Details and Branch Comparison. */
  shared: 'shared.css',
  commitGraph: 'commitGraph.css',
  commitDetails: 'commitDetails.css',
  pullRequestDetails: 'pullRequestDetails.css',
  chat: 'chat.css',
  branchComparison: 'branchComparison.css',
  visualFileHistory: 'visualFileHistory.css',
  rebaseEditor: 'rebaseEditor.css',
  launchpad: 'launchpad.css',
  panelIcon: 'panel-icon.svg',
} as const;

/** URI schemes GitLore serves content for. Read-only — a document at a ref is immutable. */
export const SCHEMES = {
  /** One file's contents at one git ref, backing the native diff editor. */
  gitContent: 'gitlore-git',
} as const;

export const CONTEXT_KEYS = {
  fileHistoryHasContent: 'gitLore.fileHistory.hasContent',
} as const;
