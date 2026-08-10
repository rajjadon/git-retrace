import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIA } from '../../src/constants';

// `__dirname`, not `import.meta.dirname`: the project emits CommonJS, so `import.meta` is a
// compile error here. Resolving from this file (rather than cwd) keeps the test runner-agnostic.
const MEDIA_DIR = join(__dirname, '..', '..', 'media');

/*
 * Regression guard. `media/diff.css` was renamed to `media/shared.css` while a provider kept
 * requesting the old name. A missing webview stylesheet fails *silently* — the browser 404s the
 * <link>, the panel renders completely unstyled, and nothing throws. Neither `tsc` nor the render
 * unit tests could catch it, because the render functions take stylesheet URIs as arguments and the
 * tests pass their own. So the names live in one constant, and this asserts they exist on disk.
 */

test('MEDIA: every referenced webview asset exists in media/', () => {
  for (const [key, filename] of Object.entries(MEDIA)) {
    assert.ok(existsSync(join(MEDIA_DIR, filename)), `MEDIA.${key} points at missing media/${filename}`);
  }
});

test('MEDIA: every stylesheet in media/ is actually referenced', () => {
  // The other direction: an orphaned stylesheet means a rename left the old copy behind, and the
  // next reader can't tell which of the two is live.
  const referenced = new Set<string>(Object.values(MEDIA));
  const orphans = readdirSync(MEDIA_DIR).filter((name) => name.endsWith('.css') && !referenced.has(name));
  assert.deepEqual(orphans, [], `unreferenced stylesheets in media/: ${orphans.join(', ')}`);
});
