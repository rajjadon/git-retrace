import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBlamePorcelain } from '../../../../src/core/git/parsers';

const goldenDir = join(__dirname, '../../../fixtures/golden');

function loadGolden(name: string): { raw: string; expected: unknown } {
  const raw = readFileSync(join(goldenDir, `${name}.txt`), 'utf8');
  const expected = JSON.parse(readFileSync(join(goldenDir, `${name}.expected.json`), 'utf8'));
  return { raw, expected };
}

test('parseBlamePorcelain: simple two-commit file, metadata repeated for every line', () => {
  const { raw, expected } = loadGolden('blame-simple');
  assert.deepEqual(parseBlamePorcelain(raw), expected);
});

test('parseBlamePorcelain: uncommitted trailing line is flagged isUncommitted', () => {
  const { raw, expected } = loadGolden('blame-uncommitted');
  assert.deepEqual(parseBlamePorcelain(raw), expected);
});

test('parseBlamePorcelain: empty output produces empty array', () => {
  assert.deepEqual(parseBlamePorcelain(''), []);
});
