import * as vscode from 'vscode';
import { GitService } from '../core/git/GitService';
import { LruCache } from '../core/cache/LruCache';
import type { BlameLine } from '../core/git/types';
import type { GitLogger } from '../core/git/errors';
import { formatBlameLabel } from '../utils/blameFormat';
import { formatAge, formatAbsolute } from '../utils/date';
import { buildCacheKey } from '../utils/path';
import { CONFIG } from '../constants';

const DEBOUNCE_MS = 500;
const DEFAULT_CACHE_SIZE = 200;
const DEFAULT_MAX_BLAME_FILE_SIZE = 1_048_576;
/** Blame is always read against the on-disk (saved) file, so the ref side of the cache key is fixed. */
const REF = 'HEAD';

export class BlameDecorationProvider implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly cache = new LruCache<string, BlameLine[]>(DEFAULT_CACHE_SIZE);
  private readonly disposables: vscode.Disposable[] = [];
  private readonly headWatchersByRoot = new Map<string, vscode.Disposable[]>();
  private readonly invalidateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastLineByUri = new Map<string, number>();
  private lastLabelByUri = new Map<string, string | undefined>();
  private currentFileWatcher: vscode.Disposable[] | undefined;
  private enabled: boolean;

  constructor(
    private readonly git: GitService,
    private readonly logger?: GitLogger,
  ) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 3em',
        fontStyle: 'italic',
      },
    });
    this.enabled = this.getConfig<boolean>(CONFIG.blameEnabled, true);

    this.disposables.push(
      this.decorationType,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.onActiveEditorChanged(editor);
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        void this.onSelectionChanged(e);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        this.onConfigChanged(e);
      }),
    );

    if (vscode.window.activeTextEditor) {
      void this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const d of this.currentFileWatcher ?? []) {
      d.dispose();
    }
    for (const list of this.headWatchersByRoot.values()) {
      for (const d of list) {
        d.dispose();
      }
    }
    for (const timer of this.invalidateTimers.values()) {
      clearTimeout(timer);
    }
  }

  toggle(): void {
    this.enabled = !this.enabled;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    if (!this.enabled) {
      this.clearDecoration(editor);
    } else {
      void this.updateForEditor(editor);
    }
  }

  private async onActiveEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {
    this.watchCurrentFile(editor);
    if (editor) {
      await this.updateForEditor(editor);
    }
  }

  private async onSelectionChanged(e: vscode.TextEditorSelectionChangeEvent): Promise<void> {
    const uriKey = e.textEditor.document.uri.toString();
    const line = e.selections[0]?.active.line ?? 0;
    if (this.lastLineByUri.get(uriKey) === line) {
      return; // Horizontal cursor move on the same line — not a line change, ignore.
    }
    this.lastLineByUri.set(uriKey, line);
    await this.updateForEditor(e.textEditor);
  }

  private onConfigChanged(e: vscode.ConfigurationChangeEvent): void {
    if (!e.affectsConfiguration(CONFIG.section)) {
      return;
    }
    this.enabled = this.getConfig<boolean>(CONFIG.blameEnabled, true);
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    if (!this.enabled) {
      this.clearDecoration(editor);
    } else {
      void this.updateForEditor(editor);
    }
  }

  private async updateForEditor(editor: vscode.TextEditor): Promise<void> {
    if (!this.enabled || editor.document.uri.scheme !== 'file') {
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const line = editor.selection.active.line;
    const maxSize = this.getConfig<number>(CONFIG.maxBlameFileSize, DEFAULT_MAX_BLAME_FILE_SIZE);
    if (Buffer.byteLength(editor.document.getText(), 'utf8') > maxSize) {
      this.clearDecoration(editor);
      return;
    }

    const blameLines = await this.getBlameLines(filePath);
    const entry = blameLines?.find((l) => l.line === line);
    if (!entry) {
      this.clearDecoration(editor);
      return;
    }

    const range = new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER);
    const highlight = this.getConfig<boolean>(CONFIG.blameHighlightCurrentLine, true);
    const label = this.formatEntry(entry);
    editor.setDecorations(this.decorationType, [
      {
        range,
        renderOptions: {
          after: {
            contentText: label,
            color: new vscode.ThemeColor(
              highlight ? 'editorCodeLens.foreground' : 'descriptionForeground',
            ),
          },
        },
      },
    ]);
    this.lastLabelByUri.set(editor.document.uri.toString(), label);
  }

  /** Test-only introspection seam — VS Code's public API doesn't expose applied decorations. */
  getRenderedLabel(uri: vscode.Uri): string | undefined {
    return this.lastLabelByUri.get(uri.toString());
  }

  private clearDecoration(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
    this.lastLabelByUri.set(editor.document.uri.toString(), undefined);
  }

  private async getBlameLines(filePath: string): Promise<BlameLine[] | null> {
    const repoRoot = await this.git.getRepoRoot(filePath);
    if (!repoRoot) {
      return null;
    }

    const key = buildCacheKey(repoRoot, filePath, REF);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const ignoreWhitespace = this.getConfig<boolean>(CONFIG.blameIgnoreWhitespace, true);
      const lines = await this.git.blameFile(filePath, { ignoreWhitespace });
      this.cache.set(key, lines);
      this.watchHeadFor(repoRoot);
      return lines;
    } catch (err) {
      // Ambient decoration failures stay silent visually — log only, to avoid popup spam
      // every time a file in a broken repo is opened. Command-triggered actions do surface errors.
      this.logger?.error(`blame failed for ${filePath}`, err);
      return null;
    }
  }

  private formatEntry(entry: BlameLine): string {
    const format = this.getConfig<string>(CONFIG.blameFormat, '{author}, {age}');
    const date = new Date(entry.authorTime * 1000);
    return formatBlameLabel(format, {
      author: entry.isUncommitted ? 'You' : entry.author,
      age: entry.isUncommitted ? 'uncommitted' : formatAge(date),
      date: formatAbsolute(date, 'yyyy-MM-dd'),
      message: entry.summary,
      sha: entry.sha.slice(0, 7),
    });
  }

  /** One filesystem watcher on the active file, replaced whenever the active editor changes. */
  private watchCurrentFile(editor: vscode.TextEditor | undefined): void {
    for (const d of this.currentFileWatcher ?? []) {
      d.dispose();
    }
    this.currentFileWatcher = undefined;

    if (!editor || editor.document.uri.scheme !== 'file') {
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(editor.document.uri.fsPath);
    const invalidate = (): void => {
      void this.invalidateForFile(editor.document.uri.fsPath);
    };
    this.currentFileWatcher = [watcher.onDidChange(invalidate), watcher, watcher.onDidCreate(invalidate)];
  }

  /** One shared HEAD/refs watcher per repo root — a branch switch affects every file in that repo. */
  private watchHeadFor(repoRoot: string): void {
    if (this.headWatchersByRoot.has(repoRoot)) {
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(repoRoot, '.git/{HEAD,refs/**}'),
    );
    const invalidate = (): void => this.scheduleInvalidate(repoRoot);
    this.headWatchersByRoot.set(repoRoot, [watcher, watcher.onDidChange(invalidate), watcher.onDidCreate(invalidate)]);
  }

  private async invalidateForFile(filePath: string): Promise<void> {
    const repoRoot = await this.git.getRepoRoot(filePath);
    if (repoRoot) {
      this.scheduleInvalidate(repoRoot);
    }
  }

  private scheduleInvalidate(repoRoot: string): void {
    const existing = this.invalidateTimers.get(repoRoot);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.invalidateTimers.delete(repoRoot);
      this.cache.deleteWhere((key) => key.startsWith(`${repoRoot}:`));
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        void this.updateForEditor(editor);
      }
    }, DEBOUNCE_MS);
    this.invalidateTimers.set(repoRoot, timer);
  }

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(CONFIG.section).get<T>(key, fallback);
  }
}
