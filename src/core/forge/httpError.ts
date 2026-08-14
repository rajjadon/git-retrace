/**
 * Best-effort extraction of a human-readable reason from a failed forge API response body. Each
 * host shapes its error JSON differently (GitHub: `{ message, errors: [{ message }] }`; GitLab:
 * `{ message }` or `{ error, error_description }`; Bitbucket: `{ error: { message } }`; Azure
 * DevOps: `{ message }`) — this tries the field names actually seen across all four rather than
 * assuming one shape, so a real rejection reason (e.g. "Can not approve your own pull request")
 * reaches the user instead of a bare status code.
 */
export function describeErrorBody(bodyText: string): string | undefined {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof parsed.message === 'string') {
      parts.push(parsed.message);
    }
    if (Array.isArray(parsed.errors)) {
      for (const entry of parsed.errors) {
        if (typeof entry === 'string') {
          parts.push(entry);
        } else if (entry && typeof (entry as { message?: unknown }).message === 'string') {
          parts.push((entry as { message: string }).message);
        }
      }
    }
    const nestedError = parsed.error;
    if (typeof nestedError === 'string') {
      parts.push(nestedError);
    } else if (nestedError && typeof (nestedError as { message?: unknown }).message === 'string') {
      parts.push((nestedError as { message: string }).message);
    }
    if (typeof parsed.error_description === 'string') {
      parts.push(parsed.error_description);
    }
    return parts.length > 0 ? parts.join('; ') : undefined;
  } catch {
    // Not JSON — some hosts (or a proxy in front of one) return a plain-text error body.
    return trimmed.slice(0, 300);
  }
}
