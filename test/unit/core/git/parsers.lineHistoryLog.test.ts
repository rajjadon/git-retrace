import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineHistoryLog } from '../../../../src/core/git/parsers';

const FIELD = '\x1f';
const RECORD = '\x1e';

function record(fields: string[], hunk: string): string {
  return RECORD + fields.join(FIELD) + '\n' + hunk;
}

test('parseLineHistoryLog: extracts commit metadata and discards the diff hunk that follows it', () => {
  const raw =
    record(
      ['c1b6a117b4692289af63e689d9deb157a532da87', 'c1b6a11', 'Raj Jadon', 'raj@example.com', '2026-08-13T02:51:12+05:30', 'chore: bump version'],
      '\ndiff --git a/package.json b/package.json\nindex 34c9f98..1dd0a6d 100644\n--- a/package.json\n+++ b/package.json\n@@ -5,1 +5,1 @@\n-  "version": "0.3.0",\n+  "version": "0.3.1",\n',
    ) +
    record(
      ['78c1a909d4f1abc523b462f142d4a24878355ee0', '78c1a90', 'Amy Dev', 'amy@example.com', '2026-08-13T02:17:09+05:30', 'Phase 2 (#4)'],
      '\ndiff --git a/package.json b/package.json\nindex c2cb8c2..1a50549 100644\n--- a/package.json\n+++ b/package.json\n@@ -5,1 +5,1 @@\n-  "version": "0.2.0",\n+  "version": "0.3.0",\n',
    );

  assert.deepEqual(parseLineHistoryLog(raw), [
    {
      sha: 'c1b6a117b4692289af63e689d9deb157a532da87',
      shortSha: 'c1b6a11',
      author: 'Raj Jadon',
      authorEmail: 'raj@example.com',
      date: '2026-08-13T02:51:12+05:30',
      message: 'chore: bump version',
    },
    {
      sha: '78c1a909d4f1abc523b462f142d4a24878355ee0',
      shortSha: '78c1a90',
      author: 'Amy Dev',
      authorEmail: 'amy@example.com',
      date: '2026-08-13T02:17:09+05:30',
      message: 'Phase 2 (#4)',
    },
  ]);
});

test('parseLineHistoryLog: a single-revision line produces one entry', () => {
  const raw = record(
    ['c8f9cb2da5f15efff1f4ef7f8d35c5326ea1ec8d', 'c8f9cb2', 'Raj Jadon', 'raj@example.com', '2026-08-10T16:19:33+05:30', 'feat: scaffold extension'],
    '\ndiff --git a/package.json b/package.json\nnew file mode 100644\nindex 0000000..b17a640\n--- /dev/null\n+++ b/package.json\n@@ -0,0 +5,1 @@\n+  "version": "0.1.0",\n',
  );
  assert.equal(parseLineHistoryLog(raw).length, 1);
});

test('parseLineHistoryLog: empty output produces an empty array', () => {
  assert.deepEqual(parseLineHistoryLog(''), []);
});
