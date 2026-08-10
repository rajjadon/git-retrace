#!/usr/bin/env node
// Node's test runner only auto-discovers .js/.mjs/.cjs files in directory mode, never .ts —
// so we collect *.test.ts files ourselves and pass them to `tsx --test` explicitly.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTestFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, acc);
    } else if (entry.name.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectTestFiles('test/unit');
if (files.length === 0) {
  process.stdout.write('No unit test files found under test/unit.\n');
  process.exit(0);
}

const result = spawnSync('npx', ['tsx', '--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
