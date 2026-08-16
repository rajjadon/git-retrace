import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIT_TOOL_DEFINITIONS, executeGitTool } from '../../../../src/core/ai/gitTools';
import type { GitService } from '../../../../src/core/git/GitService';

function fakeGit(overrides: Partial<GitService> = {}): GitService {
  return overrides as GitService;
}

test('GIT_TOOL_DEFINITIONS: every tool has a name, description, and object inputSchema', () => {
  for (const tool of GIT_TOOL_DEFINITIONS) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('GIT_TOOL_DEFINITIONS: names are unique', () => {
  const names = GIT_TOOL_DEFINITIONS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('executeGitTool: get_file_history calls GitService.getFileHistory with filePath and maxCount', async () => {
  let called: [string, number] | undefined;
  const git = fakeGit({
    getFileHistory: async (filePath: string, maxCount: number) => {
      called = [filePath, maxCount];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_file_history', { maxCount: 10 }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 10]);
});

test('executeGitTool: get_line_history calls GitService.getLineHistory with filePath and line', async () => {
  let called: [string, number] | undefined;
  const git = fakeGit({
    getLineHistory: async (filePath: string, line: number) => {
      called = [filePath, line];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_line_history', { line: 41 }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 41]);
});

test('executeGitTool: get_commit calls GitService.getCommit with filePath and sha', async () => {
  let called: [string, string] | undefined;
  const git = fakeGit({
    getCommit: async (filePath: string, sha: string) => {
      called = [filePath, sha];
      return null;
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_commit', { sha: 'abc123' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 'abc123']);
});

test('executeGitTool: get_commit_diff truncates a diff over maxDiffChars', async () => {
  const git = fakeGit({ getCommitDiff: async () => 'x'.repeat(20) });
  const result = await executeGitTool(git, '/repo/a.ts', 'get_commit_diff', { sha: 'abc123' }, 10);
  assert.equal(result, 'x'.repeat(10) + '[...truncated]');
});

test('executeGitTool: get_commit_files calls GitService.getCommitFiles', async () => {
  let called: [string, string] | undefined;
  const git = fakeGit({
    getCommitFiles: async (filePath: string, sha: string) => {
      called = [filePath, sha];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_commit_files', { sha: 'abc123' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 'abc123']);
});

test('executeGitTool: get_commits_between calls GitService.getCommitsBetween with from and to', async () => {
  let called: [string, string, string] | undefined;
  const git = fakeGit({
    getCommitsBetween: async (filePath: string, from: string, to: string) => {
      called = [filePath, from, to];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_commits_between', { from: 'main', to: 'feature' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 'main', 'feature']);
});

test('executeGitTool: get_diff_between_refs truncates a diff over maxDiffChars', async () => {
  const git = fakeGit({ getDiffBetweenRefs: async () => 'y'.repeat(20) });
  const result = await executeGitTool(git, '/repo/a.ts', 'get_diff_between_refs', { base: 'main', compare: 'feature' }, 10);
  assert.equal(result, 'y'.repeat(10) + '[...truncated]');
});

test('executeGitTool: get_branches calls GitService.getBranches', async () => {
  let called: string | undefined;
  const git = fakeGit({
    getBranches: async (filePath: string) => {
      called = filePath;
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_branches', {}, 8000);
  assert.equal(called, '/repo/a.ts');
});

test('executeGitTool: get_graph_commits passes maxCount and an optional ref through', async () => {
  let called: [string, number, string | undefined] | undefined;
  const git = fakeGit({
    getGraphCommits: async (filePath: string, maxCount: number, ref?: string) => {
      called = [filePath, maxCount, ref];
      return [];
    },
  });
  await executeGitTool(git, '/repo/a.ts', 'get_graph_commits', { maxCount: 50, ref: 'main' }, 8000);
  assert.deepEqual(called, ['/repo/a.ts', 50, 'main']);
});

test('executeGitTool: an unknown tool name throws', async () => {
  await assert.rejects(() => executeGitTool(fakeGit(), '/repo/a.ts', 'not_a_real_tool', {}, 8000), /Unknown tool/);
});

test('executeGitTool: a missing required argument throws instead of calling GitService with undefined', async () => {
  const git = fakeGit({ getCommit: async () => { throw new Error('should not be called'); } });
  await assert.rejects(() => executeGitTool(git, '/repo/a.ts', 'get_commit', {}, 8000), /requires/);
});
