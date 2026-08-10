import * as vscode from 'vscode';
import type { GitService } from '../core/git/GitService';
import type { IssueLinkOptions } from '../utils/issueLinks';
import { CONFIG } from '../constants';

const DEFAULT_PATTERN = '#(\\d+)';

/** Resolves the issue-linking config for a file, or null if disabled or unresolvable (no configured template and no recognizable git remote). */
export async function resolveIssueLinking(git: GitService, filePath: string): Promise<IssueLinkOptions | null> {
  const config = vscode.workspace.getConfiguration(CONFIG.section);
  if (!config.get<boolean>(CONFIG.issueLinkingEnabled, true)) {
    return null;
  }
  const pattern = config.get<string>(CONFIG.issueLinkingPattern, DEFAULT_PATTERN);
  const configuredTemplate = config.get<string>(CONFIG.issueLinkingUrlTemplate, '');
  const urlTemplate = await git.resolveIssueUrlTemplate(filePath, configuredTemplate);
  return urlTemplate ? { pattern, urlTemplate } : null;
}
