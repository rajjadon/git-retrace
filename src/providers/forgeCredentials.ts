import * as vscode from 'vscode';
import type { DetectedForgeHost } from '../core/forge/hostDetection';

function secretKeyFor(displayHost: string): string {
  return `gitLore.launchpad.pat.${displayHost}`;
}

/**
 * Resolves the credential Launchpad needs to call a host's API. GitHub's public `github.com` gets
 * VS Code's own built-in authentication session — no GitLore backend, no key ever handled by
 * GitLore itself. Every other host (GitLab, Bitbucket, Azure DevOps, and GitHub Enterprise
 * Server/Gitea/Forgejo via `customHosts`, none of which VS Code ships a built-in session
 * provider for) needs a Personal Access Token, entered once and stored in VS Code's own encrypted
 * `SecretStorage` — the user's token, on their machine, never sent anywhere but that host itself.
 *
 * Returns null if the user declines to sign in / enter a token — the caller shows that repo as
 * "not signed in" rather than failing the whole board.
 */
export async function resolveForgeToken(
  secrets: vscode.SecretStorage,
  detected: DetectedForgeHost,
): Promise<string | null> {
  if (detected.flavor === 'github' && detected.displayHost === 'github.com') {
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    return session?.accessToken ?? null;
  }

  const key = secretKeyFor(detected.displayHost);
  const existing = await secrets.get(key);
  if (existing) {
    return existing;
  }

  const entered = await vscode.window.showInputBox({
    title: `GitLore: Personal Access Token for ${detected.displayHost}`,
    prompt: `Needed to show pull requests from ${detected.displayHost} in Launchpad. Stored locally in VS Code's encrypted secret storage — never sent anywhere but ${detected.displayHost} itself.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!entered) {
    return null;
  }
  await secrets.store(key, entered);
  return entered;
}

/** Clears a stored token — used when a host rejects it, so the next refresh re-prompts instead of retrying the same bad credential forever. Never touches the GitHub session (VS Code owns that lifecycle, not GitLore). */
export async function clearForgeToken(secrets: vscode.SecretStorage, detected: DetectedForgeHost): Promise<void> {
  if (detected.flavor === 'github' && detected.displayHost === 'github.com') {
    return;
  }
  await secrets.delete(secretKeyFor(detected.displayHost));
}
