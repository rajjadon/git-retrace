/** Escapes HTML special characters. Webview content is built via string concatenation (no auto-escaping templating engine), so anything sourced from git data (attacker-influenced in an untrusted repo) must go through this before interpolation. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
