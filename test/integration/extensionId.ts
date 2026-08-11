/**
 * The extension's Marketplace identifier, `<publisher>.<name>` from package.json.
 *
 * One constant rather than the same literal in nine suites: it has already had to change twice —
 * once for the GitSense → Git Retrace rename, once when the publisher id was settled — and each
 * time it meant editing every integration test. Keep this in sync with package.json's `publisher`
 * and `name`; `test/unit/contributions.test.ts` guards the rest of the manifest.
 */
export const EXTENSION_ID = 'RajpratapsinghJadon.git-retrace';
