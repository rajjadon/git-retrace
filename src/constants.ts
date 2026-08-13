/** Single source of truth for command IDs, config keys, view IDs, and context keys. No magic strings elsewhere. */

export const OUTPUT_CHANNEL_NAME = 'GitLore';

/** Default for `gitLore.maxBlameFileSize` — shared so every blame-consuming provider agrees on the fallback. */
export const DEFAULT_MAX_BLAME_FILE_SIZE = 1_048_576;

export const COMMANDS = {
  toggleBlame: 'gitLore.toggleBlame',
  showFileHistory: 'gitLore.showFileHistory',
  showCommit: 'gitLore.showCommit',
  copySha: 'gitLore.copySha',
  openGraph: 'gitLore.openGraph',
  showVisualFileHistory: 'gitLore.showVisualFileHistory',
  compareBranches: 'gitLore.compareBranches',
  explainCommit: 'gitLore.explainCommit',
  explainLine: 'gitLore.explainLine',
  showFileOwnership: 'gitLore.showFileOwnership',
  rebaseInteractively: 'gitLore.rebaseInteractively',
  checkoutBranch: 'gitLore.checkoutBranch',
  compareBranchFromExplorer: 'gitLore.compareBranchFromExplorer',
  openRemote: 'gitLore.openRemote',
  applyStash: 'gitLore.applyStash',
  dropStash: 'gitLore.dropStash',
  stepLineHistory: 'gitLore.stepLineHistory',
  toggleFullFileBlame: 'gitLore.toggleFullFileBlame',
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
  dateFormat: 'dateFormat',
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
  rebaseEditorEnabled: 'rebaseEditor.enabled',
} as const;

export const VIEWS = {
  fileHistory: 'gitLore.fileHistory',
  commitDetails: 'gitLore.commitDetails',
  commitGraph: 'gitLore.commitGraph',
  branchComparison: 'gitLore.branchComparison',
  visualFileHistory: 'gitLore.visualFileHistory',
  rebaseEditor: 'gitLore.rebaseEditor',
  explorer: 'gitLore.explorer',
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
  branchComparison: 'branchComparison.css',
  visualFileHistory: 'visualFileHistory.css',
  rebaseEditor: 'rebaseEditor.css',
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
