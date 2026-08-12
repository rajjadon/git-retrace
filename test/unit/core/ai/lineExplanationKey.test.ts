import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineExplanationKey } from '../../../../src/core/ai/lineExplanationKey';

test('buildLineExplanationKey: uses repoRoot when available', () => {
  assert.equal(buildLineExplanationKey('/repo', '/repo/src/a.ts', 'abc123', 'line three'), '/repo:abc123:line three');
});

test('buildLineExplanationKey: falls back to filePath when repoRoot is null', () => {
  assert.equal(buildLineExplanationKey(null, '/repo/src/a.ts', 'abc123', 'line three'), '/repo/src/a.ts:abc123:line three');
});

test('buildLineExplanationKey: different line content produces different keys for the same commit', () => {
  const key1 = buildLineExplanationKey('/repo', '/repo/src/a.ts', 'abc123', 'line one');
  const key2 = buildLineExplanationKey('/repo', '/repo/src/a.ts', 'abc123', 'line two');
  assert.notEqual(key1, key2);
});
