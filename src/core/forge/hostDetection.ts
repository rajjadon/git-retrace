import type { ForgeHost } from './types';

/** A self-hosted/custom instance GitLore doesn't recognize by hostname alone — user-configured via `gitLore.launchpad.customHosts`. GitHub Enterprise Server and Gitea/Forgejo (API-compatible with GitHub) both use the `github` flavor with their own `apiBaseUrl`; self-hosted GitLab CE/EE uses `gitlab` the same way. */
export interface ForgeHostConfig {
  hostname: string;
  flavor: ForgeHost;
  apiBaseUrl: string;
}

export interface DetectedForgeHost {
  flavor: ForgeHost;
  apiBaseUrl: string;
  /** The remote's own hostname — for display and as the SecretStorage/session key, distinct from `apiBaseUrl` (GHE's API lives at `<host>/api/v3`, Azure DevOps's at a wholly different `dev.azure.com` regardless of the remote's own visualstudio.com host). */
  displayHost: string;
}

const WELL_KNOWN_HOSTS: Record<string, Omit<DetectedForgeHost, 'displayHost'>> = {
  'github.com': { flavor: 'github', apiBaseUrl: 'https://api.github.com' },
  'gitlab.com': { flavor: 'gitlab', apiBaseUrl: 'https://gitlab.com/api/v4' },
  'bitbucket.org': { flavor: 'bitbucket', apiBaseUrl: 'https://api.bitbucket.org/2.0' },
};

/** `dev.azure.com` and the legacy `<org>.visualstudio.com` both identify an Azure DevOps remote — the API itself is always served from `dev.azure.com`, regardless of which form the remote URL used. */
function isAzureDevOpsHost(host: string): boolean {
  return host === 'dev.azure.com' || host.endsWith('.visualstudio.com');
}

/**
 * Resolves which host "flavor" (API shape to speak) and base URL a remote's hostname maps to.
 * The four public hosts need zero configuration; anything else — GitHub Enterprise Server,
 * self-hosted GitLab, Gitea/Forgejo, or any other forge — needs an explicit entry in
 * `customHosts` telling GitLore which of the four API shapes it speaks and where. Returns null
 * for an unrecognized, unconfigured host — the caller skips that repo rather than guessing.
 *
 * Pure — no I/O, no vscode import.
 */
export function detectForgeHost(host: string, customHosts: ForgeHostConfig[]): DetectedForgeHost | null {
  const normalized = host.toLowerCase();
  if (isAzureDevOpsHost(normalized)) {
    return { flavor: 'azureDevOps', apiBaseUrl: 'https://dev.azure.com', displayHost: host };
  }
  const wellKnown = WELL_KNOWN_HOSTS[normalized];
  if (wellKnown) {
    return { ...wellKnown, displayHost: host };
  }
  const custom = customHosts.find((c) => c.hostname.toLowerCase() === normalized);
  if (custom) {
    return { flavor: custom.flavor, apiBaseUrl: custom.apiBaseUrl, displayHost: host };
  }
  return null;
}
