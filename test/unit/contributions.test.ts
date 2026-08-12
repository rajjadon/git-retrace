import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS, VIEWS } from '../../src/constants';
import { EXTENSION_ID } from '../integration/extensionId';

interface Manifest {
  name: string;
  publisher: string;
  contributes: {
    commands: Array<{ command: string; title: string; icon?: string }>;
    menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
    views: Record<string, Array<{ id: string }>>;
  };
}

const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
) as Manifest;
const { commands, menus, views } = manifest.contributes;
const commandIds = new Set(commands.map((c) => c.command));
const viewIds = new Set(Object.values(views).flat().map((v) => v.id));

/*
 * package.json contributions are plain strings that nothing type-checks: a typo'd command id in a
 * menu entry makes the button silently not appear, and a typo'd view id makes the `when` clause
 * never match. Same failure mode as the media/*.css rename — quiet, not loud. So the manifest is
 * cross-checked against constants.ts here.
 */

test('contributes.commands: every COMMANDS entry that is user-invocable is declared', () => {
  // explainLine is reserved for a future sub-project and intentionally not contributed yet.
  // explainCommit is now legitimately contributed (package.json + handleExplainCommitCommand).
  const reserved = new Set<string>([COMMANDS.explainLine]);
  for (const [key, id] of Object.entries(COMMANDS)) {
    if (reserved.has(id)) {
      assert.ok(!commandIds.has(id), `COMMANDS.${key} is reserved but declared in package.json`);
      continue;
    }
    assert.ok(commandIds.has(id), `COMMANDS.${key} (${id}) is missing from contributes.commands`);
  }
});

test('contributes.commands: titles are namespaced so the command palette groups them', () => {
  for (const cmd of commands) {
    assert.match(cmd.title, /^GitLore: /, `${cmd.command} has an un-namespaced title: ${cmd.title}`);
  }
});

test('view/title: every menu entry names a real command and a real view', () => {
  const titleMenu = menus['view/title'] ?? [];
  assert.ok(titleMenu.length > 0, 'expected panel views to expose commands as title-bar buttons');
  for (const entry of titleMenu) {
    assert.ok(commandIds.has(entry.command), `view/title references unknown command ${entry.command}`);
    const match = /^view == ([\w.]+)$/.exec(entry.when ?? '');
    assert.ok(match, `view/title entry for ${entry.command} needs a "view == <id>" when-clause`);
    assert.ok(viewIds.has(match[1] ?? ''), `view/title references unknown view ${match[1]}`);
  }
});

test('view/title: a command shown as a title-bar button has an icon, or it renders as blank space', () => {
  const byId = new Map(commands.map((c) => [c.command, c]));
  for (const entry of menus['view/title'] ?? []) {
    const cmd = byId.get(entry.command);
    assert.ok(cmd?.icon, `${entry.command} appears in view/title but has no icon`);
    assert.match(cmd.icon, /^\$\([a-z0-9-]+\)$/, `${entry.command} icon must be a codicon id, got ${cmd.icon}`);
  }
});

test('view/title: each of the three panel views exposes at least one command', () => {
  const titleMenu = menus['view/title'] ?? [];
  for (const view of [VIEWS.commitGraph, VIEWS.commitDetails, VIEWS.branchComparison]) {
    const forView = titleMenu.filter((e) => e.when === `view == ${view}`);
    assert.ok(forView.length > 0, `${view} has no title-bar commands`);
  }
});

test('commandPalette: copySha is hidden, because there is no commit selected there', () => {
  const hidden = (menus['commandPalette'] ?? []).filter((e) => e.when === 'false').map((e) => e.command);
  assert.ok(hidden.includes(COMMANDS.copySha), 'gitLore.copySha must be hidden from the command palette');
});

test('view/item/context: entries name real commands and real views', () => {
  for (const entry of menus['view/item/context'] ?? []) {
    assert.ok(commandIds.has(entry.command), `view/item/context references unknown command ${entry.command}`);
    assert.ok(
      [...viewIds].some((id) => (entry.when ?? '').includes(id)),
      `view/item/context entry for ${entry.command} references no known view`,
    );
  }
});

test('contributes.views: every VIEWS entry is declared exactly once', () => {
  const declared = Object.values(views).flat().map((v) => v.id);
  for (const [key, id] of Object.entries(VIEWS)) {
    assert.equal(declared.filter((d) => d === id).length, 1, `VIEWS.${key} (${id}) must be declared exactly once`);
  }
});

test("EXTENSION_ID matches the manifest's publisher.name", () => {
  // The integration suites look the extension up by this id; if it drifts from package.json,
  // every one of them fails with "extension not found" rather than pointing at the cause.
  assert.equal(EXTENSION_ID, `${manifest.publisher}.${manifest.name}`);
});
