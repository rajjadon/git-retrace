/*
 * Regenerates the README's screenshots of *native* VS Code UI: `npm run shots:native`.
 *
 * `scripts/shoot-screenshots.ts` covers webview panels by rendering their real HTML with headless
 * Chrome — there's no VS Code host involved at all. That trick doesn't exist for an editor
 * decoration, a CodeLens, a TreeView, or an overview-ruler mark: none of those have HTML to render
 * outside VS Code itself. This script drives an actual VS Code window instead, via Playwright's
 * Electron support (`_electron.launch`), pointed at the real `.vscode-test`-cached binary the
 * integration tests already use.
 *
 * Uses `scripts/build-demo-repo.ts` rather than `test/fixtures/` — those fixtures optimize for
 * deterministic assertions (tiny files, "alice line one" placeholder text), not a screenshot
 * anyone would want to look at.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { buildDemoRepo } from './build-demo-repo';

const REPO = resolve(__dirname, '..');
const OUT = join(REPO, 'media', 'screenshots');
const isMac = process.platform === 'darwin';
const MOD = isMac ? 'Meta' : 'Control';

/** Same fallback `@vscode/test-electron` needs in `test/integration/runTests.ts`: some VS Code builds' Info.plist declares a different `CFBundleExecutable`. */
async function resolveVscodeExecutablePath(): Promise<string> {
  const expected = await downloadAndUnzipVSCode();
  if (existsSync(expected)) {
    return expected;
  }
  const macosDir = dirname(expected);
  const actual = readdirSync(macosDir).find((name) => statSync(join(macosDir, name)).isFile());
  if (!actual) {
    throw new Error(`Could not locate the VS Code executable in ${macosDir}`);
  }
  return join(macosDir, actual);
}

async function launch(repoRoot: string, settings: Record<string, unknown> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = await resolveVscodeExecutablePath();
  const userDataDir = mkdtempSync(join(tmpdir(), 'gitlore-shots-userdata-'));
  const userDir = join(userDataDir, 'User');
  mkdirSync(userDir, { recursive: true });
  writeFileSync(
    join(userDir, 'settings.json'),
    // `reduceMotion: 'on'` skips the hover widget's opacity fade-in transition, which otherwise
    // leaves a narrow, hard-to-catch window where the widget is unhidden but still at opacity 0.
    JSON.stringify({ 'window.zoomLevel': 0, 'workbench.reduceMotion': 'on', ...settings }, null, 2),
  );

  const app = await electron.launch({
    executablePath,
    args: [
      repoRoot,
      `--extensionDevelopmentPath=${REPO}`,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      `--user-data-dir=${userDataDir}`,
    ],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.monaco-workbench', { timeout: 30_000 });
  await page.setViewportSize({ width: 1400, height: 900 });
  // Let the workbench settle (extension activation, git status, etc.) before driving it.
  await page.waitForTimeout(1500);
  return { app, page };
}

/**
 * Clears the "All installed extensions are temporarily disabled" notification and closes the
 * unrelated Chat sidebar — cosmetic cleanup only, so it deliberately runs through the command
 * palette *after* a file has already been opened and focused. Running these same two commands
 * immediately after launch (before anything else has focus) left the workbench in a state where
 * the blame hover would never show again for the rest of the session, for reasons that didn't
 * repro consistently enough to chase further — moving them here made it go away.
 */
async function dismissChrome(page: Page): Promise<void> {
  await runCommand(page, 'Notifications: Clear All Notifications');
  await runCommand(page, 'View: Close Auxiliary Bar');
}

async function openFile(page: Page, basename: string): Promise<void> {
  await page.keyboard.press(`${MOD}+P`);
  await page.waitForTimeout(300);
  await page.keyboard.type(basename);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
}

async function goToLine(page: Page, line: number): Promise<void> {
  // Keybindings for "Go to Line" vary/are unreliable to guess across platforms — drive it through
  // the command palette instead, same as `runCommand`, then type the line number into the input
  // box that command itself opens.
  await page.keyboard.press(`${MOD}+Shift+P`);
  await page.waitForTimeout(300);
  await page.keyboard.type('Go to Line/Column');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type(String(line));
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

async function runCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`);
  await page.waitForTimeout(300);
  await page.keyboard.type(command);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
}

async function shootElement(page: Page, selector: string, name: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.screenshot({ path: join(OUT, `${name}.png`) });
  process.stdout.write(`  wrote media/screenshots/${name}.png\n`);
}

async function shootPage(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  process.stdout.write(`  wrote media/screenshots/${name}.png\n`);
}

/** Clips to just one pane within the sidebar (by its header text) instead of the whole sidebar, which would otherwise include a lot of empty space from neighboring collapsed/short panes. */
async function shootPane(page: Page, headerText: string, height: number, name: string): Promise<void> {
  const header = page.locator('.pane-header', { hasText: headerText }).first();
  const headerBox = await header.boundingBox();
  const sidebarBox = await page.locator('.sidebar').first().boundingBox();
  if (!headerBox || !sidebarBox) {
    throw new Error(`could not locate the "${headerText}" pane to screenshot`);
  }
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: sidebarBox.x, y: headerBox.y, width: sidebarBox.width, height },
  });
  process.stdout.write(`  wrote media/screenshots/${name}.png\n`);
}

async function main(): Promise<void> {
  const manifest = buildDemoRepo();

  // Session A: default settings — inline blame, File History tree, Sidebar Explorer, stale-code CodeLens.
  {
    const { app, page } = await launch(manifest.repoRoot);
    try {
      await openFile(page, 'userProfile.ts');
      await dismissChrome(page);
      await goToLine(page, 8);
      await runCommand(page, 'Show or Focus Hover');
      // Fixed wait, then screenshot immediately: polling via waitForFunction/evaluate in between
      // (to confirm the widget's visible) made it disappear again before the screenshot fired —
      // so just wait long enough for the hover delay + fade-in and go.
      await page.waitForTimeout(900);
      // The hover widget renders in its own overlay layer, not nested inside `.editor-instance` —
      // an element-scoped screenshot would silently crop it out, so this one needs the full page.
      await shootPage(page, 'inline-blame');

      await runCommand(page, 'GitLore: Show File History');
      await page.waitForTimeout(1000);
      await shootPane(page, 'File History', 260, 'file-history');

      await openFile(page, 'authService.ts');
      await goToLine(page, 15);
      await page.waitForTimeout(1000);
      await shootElement(page, '.editor-instance', 'stale-code');

      // The co-change lens sits at line 0 — no goToLine needed, it's visible the moment the file
      // opens. Longer wait than the other lenses: this is the first file in the session whose
      // co-change data isn't already warm (userProfile.ts/authService.ts have no coupling, so
      // opening them earlier never triggered the underlying git log call this file's lens needs).
      await openFile(page, 'checkoutFlow.ts');
      await page.waitForTimeout(3000);
      await shootElement(page, '.editor-instance', 'co-change-detector');

      const activityIcon = page.locator('.activitybar a[aria-label="GitLore"]').first();
      await activityIcon.click();
      await page.waitForTimeout(1200);
      await shootElement(page, '.sidebar', 'sidebar-explorer');
    } finally {
      await app.close();
    }
  }

  // Session B: ownership + full-file-blame heatmaps enabled from the start.
  {
    const { app, page } = await launch(manifest.repoRoot, {
      'gitLore.ownership.enabled': true,
      'gitLore.fullFileBlame.enabled': true,
    });
    try {
      await openFile(page, 'userProfile.ts');
      await dismissChrome(page);
      await page.waitForTimeout(1000);
      await shootElement(page, '.editor-instance', 'full-file-blame');

      await runCommand(page, 'GitLore: Show File Ownership');
      await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
      await page.waitForTimeout(300);
      await shootPage(page, 'ownership-heatmap');
    } finally {
      await app.close();
    }
  }
}

void main();
