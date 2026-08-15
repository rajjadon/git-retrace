import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

// `__dirname`, not `import.meta.dirname`: the project emits CommonJS — see media.test.ts.
// Read, not linked: a `file://` stylesheet `<link>` against a `page.setContent()` document (opaque
// `about:blank` origin) silently fails to load at all under Playwright's default Chromium launch —
// inlining the real file's own content sidesteps that entirely while still testing the real file.
const SHARED_CSS = readFileSync(join(__dirname, '..', '..', 'media', 'shared.css'), 'utf8');

// The evaluate() callbacks below run in the browser, not this Node process — but they're still
// type-checked against this project's tsconfig, which deliberately has no "dom" lib (extension-host
// code never touches a real DOM). This declares just enough of the one global these callbacks need.
declare function getComputedStyle(element: unknown): { display: string };

/*
 * Regression guard for a real bug: `.skeleton { display: flex; ... }` gives the element its own
 * `display`, so the browser's built-in `[hidden] { display: none; }` rule — same specificity tier,
 * but a user-agent default, which always loses ties against an author stylesheet — never wins.
 * Toggling `element.hidden = true/false` from JS (exactly what the AI-summary and comment-post
 * skeletons do in place, unlike the full-page loading placeholder, which is never toggled — it's
 * replaced wholesale) silently did nothing: the skeleton stayed visible forever. A render-unit test
 * checking the HTML string can't catch this at all — `hidden` is present in the markup either way;
 * only a real browser computing actual style resolves whether it does anything. `.file[hidden]`
 * already needed the same fix, for the same reason — this guards `.skeleton` from losing it again.
 */

let browser: Browser;

test.before(async () => {
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
});

test('.skeleton actually disappears when toggled hidden, not just marked hidden in the DOM', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!DOCTYPE html><html><head><style>${SHARED_CSS}</style></head>
<body><div class="skeleton"><div class="skeleton-row"></div></div></body></html>`);

    const skeleton = page.locator('.skeleton');
    assert.equal(await skeleton.evaluate((el) => getComputedStyle(el).display), 'flex', 'sanity check: visible by default');

    await skeleton.evaluate((el) => {
      (el as { hidden: boolean }).hidden = true;
    });
    assert.equal(await skeleton.evaluate((el) => getComputedStyle(el).display), 'none', 'toggling .hidden must actually hide it');
  } finally {
    await page.close();
  }
});
