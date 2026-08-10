import { escapeHtml } from './escapeHtml';

export interface PlaceholderOptions {
  nonce: string;
  cspSource: string;
  /** Stylesheets to link — the placeholder borrows `.empty` from shared.css. */
  styleUris: string[];
}

/**
 * The document a panel view shows before it has anything to show: a webview view is resolved as
 * soon as its tab is revealed, so without this the user sees a blank rectangle and no hint that
 * the panel needs input. States what to do, in the same voice as the loaded view.
 */
export function renderPlaceholderHtml(message: string, opts: PlaceholderOptions): string {
  const styles = opts.styleUris.map((uri) => `<link rel="stylesheet" href="${uri}" />`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource};" />
${styles}
</head>
<body><p class="empty">${escapeHtml(message)}</p></body>
</html>`;
}
