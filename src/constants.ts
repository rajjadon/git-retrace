/** Single source of truth for command IDs, config keys, view IDs, and context keys. No magic strings elsewhere. */

export const OUTPUT_CHANNEL_NAME = 'GitSense';

export const COMMANDS = {
  toggleBlame: 'gitsense.toggleBlame',
  showFileHistory: 'gitsense.showFileHistory',
  showCommit: 'gitsense.showCommit',
  copySha: 'gitsense.copySha',
  openGraph: 'gitsense.openGraph',
  compareBranches: 'gitsense.compareBranches',
  // Reserved for Phase 2 — not registered in package.json yet.
  explainCommit: 'gitsense.explainCommit',
  explainLine: 'gitsense.explainLine',
} as const;

export const CONFIG = {
  section: 'gitsense',
  blameEnabled: 'blame.enabled',
  blameFormat: 'blame.format',
  blameHighlightCurrentLine: 'blame.highlightCurrentLine',
  blameIgnoreWhitespace: 'blame.ignoreWhitespace',
  maxHistoryItems: 'maxHistoryItems',
  maxBlameFileSize: 'maxBlameFileSize',
  maxGraphItems: 'maxGraphItems',
  dateFormat: 'dateFormat',
  issueLinkingEnabled: 'issueLinking.enabled',
  issueLinkingPattern: 'issueLinking.pattern',
  issueLinkingUrlTemplate: 'issueLinking.urlTemplate',
} as const;

export const VIEWS = {
  fileHistory: 'gitsense.fileHistory',
  commitDetails: 'gitsense.commitDetails',
  commitGraph: 'gitsense.commitGraph',
  branchComparison: 'gitsense.branchComparison',
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
  panelIcon: 'panel-icon.svg',
} as const;

/** URI schemes GitSense serves content for. Read-only — a document at a ref is immutable. */
export const SCHEMES = {
  /** One file's contents at one git ref, backing the native diff editor. */
  gitContent: 'gitsense-git',
} as const;

export const CONTEXT_KEYS = {
  fileHistoryHasContent: 'gitsense.fileHistory.hasContent',
} as const;
