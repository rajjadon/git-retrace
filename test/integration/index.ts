import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Mocha from 'mocha';

/** Entry point `@vscode/test-electron` loads inside the Extension Development Host. */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20_000 });
  const testsRoot = __dirname;

  return new Promise((resolve, reject) => {
    try {
      for (const file of readdirSync(testsRoot)) {
        if (file.endsWith('.test.js')) {
          mocha.addFile(join(testsRoot, file));
        }
      }
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
