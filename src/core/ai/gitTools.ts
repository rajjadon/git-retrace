import type { GitService } from '../git/GitService';
import { truncateForModel } from './prompts';

export interface GitToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/** Git-backed tools the chat model can call, each a thin wrapper over an existing `GitService` method — no new git logic. `filePath` is never part of a schema: GitLore always supplies the chat's current repo context itself, so the model is never asked to guess an absolute path. */
export const GIT_TOOL_DEFINITIONS: GitToolDefinition[] = [
  {
    name: 'get_file_history',
    description: "Every commit that touched the current file, newest first. Use this for 'who changed this file' or 'when was this file last touched'.",
    inputSchema: {
      type: 'object',
      properties: { maxCount: { type: 'number', description: 'Max commits to return.' } },
      required: ['maxCount'],
    },
  },
  {
    name: 'get_line_history',
    description: "Every commit that changed one exact line in the current file, newest first. Use this for 'who wrote this line' or 'why did this line change'.",
    inputSchema: {
      type: 'object',
      properties: { line: { type: 'number', description: '0-based line number.' } },
      required: ['line'],
    },
  },
  {
    name: 'get_commit',
    description: 'Full metadata (author, date, full commit message) for one commit by its SHA.',
    inputSchema: {
      type: 'object',
      properties: { sha: { type: 'string', description: 'A commit SHA, full or abbreviated.' } },
      required: ['sha'],
    },
  },
  {
    name: 'get_commit_diff',
    description: "One commit's unified diff, across every file it touched.",
    inputSchema: {
      type: 'object',
      properties: { sha: { type: 'string', description: 'A commit SHA, full or abbreviated.' } },
      required: ['sha'],
    },
  },
  {
    name: 'get_commit_files',
    description: 'Every file one commit touched, with insertion/deletion counts.',
    inputSchema: {
      type: 'object',
      properties: { sha: { type: 'string', description: 'A commit SHA, full or abbreviated.' } },
      required: ['sha'],
    },
  },
  {
    name: 'get_commits_between',
    description: "Commits reachable from 'to' but not from 'from' — e.g. what one branch/tag has that another doesn't.",
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Ref, branch, tag, or SHA to start from.' },
        to: { type: 'string', description: 'Ref, branch, tag, or SHA to end at.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_diff_between_refs',
    description: 'Unified diff between two refs (branches, tags, or SHAs), against their merge-base.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Base ref.' },
        compare: { type: 'string', description: 'Compare ref.' },
      },
      required: ['base', 'compare'],
    },
  },
  {
    name: 'get_branches',
    description: 'Every local and remote branch in the repo.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_graph_commits',
    description: "Repo-wide commit history (every branch by default, or one branch via 'ref'), newest first.",
    inputSchema: {
      type: 'object',
      properties: {
        maxCount: { type: 'number', description: 'Max commits to return.' },
        ref: { type: 'string', description: 'Optional: limit to this one branch instead of every branch.' },
      },
      required: ['maxCount'],
    },
  },
];

function requireString(args: Record<string, unknown>, key: string, toolName: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`Tool '${toolName}' requires a string '${key}' argument.`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string, toolName: string): number {
  const value = args[key];
  if (typeof value !== 'number') {
    throw new Error(`Tool '${toolName}' requires a numeric '${key}' argument.`);
  }
  return value;
}

/** Dispatches one tool call to the matching `GitService` method. Diff-shaped results are truncated the same way commit-summary prompts already are. Throws on an unknown tool name or a missing argument — caught by `chatFlow.ts`'s loop and fed back to the model as a tool-result error, never crashing the chat. */
export async function executeGitTool(
  git: GitService,
  filePath: string,
  name: string,
  args: Record<string, unknown>,
  maxDiffChars: number,
): Promise<unknown> {
  switch (name) {
    case 'get_file_history':
      return git.getFileHistory(filePath, requireNumber(args, 'maxCount', name));
    case 'get_line_history':
      return git.getLineHistory(filePath, requireNumber(args, 'line', name));
    case 'get_commit':
      return git.getCommit(filePath, requireString(args, 'sha', name));
    case 'get_commit_diff': {
      const diff = await git.getCommitDiff(filePath, requireString(args, 'sha', name));
      return truncateForModel(diff, maxDiffChars);
    }
    case 'get_commit_files':
      return git.getCommitFiles(filePath, requireString(args, 'sha', name));
    case 'get_commits_between':
      return git.getCommitsBetween(filePath, requireString(args, 'from', name), requireString(args, 'to', name));
    case 'get_diff_between_refs': {
      const diff = await git.getDiffBetweenRefs(filePath, requireString(args, 'base', name), requireString(args, 'compare', name));
      return truncateForModel(diff, maxDiffChars);
    }
    case 'get_branches':
      return git.getBranches(filePath);
    case 'get_graph_commits': {
      const ref = typeof args.ref === 'string' ? args.ref : undefined;
      return git.getGraphCommits(filePath, requireNumber(args, 'maxCount', name), ref);
    }
    default:
      throw new Error(`Unknown tool: '${name}'.`);
  }
}
