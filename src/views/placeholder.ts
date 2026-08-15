import { escapeHtml } from './escapeHtml';

export interface PlaceholderOptions {
  nonce: string;
  cspSource: string;
  /** Stylesheets to link — the placeholder borrows `.empty` from shared.css. */
  styleUris: string[];
  /**
   * `'empty'` (default): a steady state with nothing to show — no live region, nothing is
   * changing. `'loading'`: a transient in-flight state — announced via `aria-busy`/`aria-live` so
   * a screen reader says "busy" instead of silence. `'error'`: a final but unexpected state — uses
   * `role="alert"` so it's announced immediately, the same way the visual message demands attention.
   */
  variant?: 'empty' | 'loading' | 'error';
}

/** Relative widths for the skeleton's rows — varied so the block doesn't read as a literal, uniform gray rectangle. */
const SKELETON_ROW_WIDTHS = ['60%', '85%', '40%'];

/**
 * The document a panel view shows before it has anything to show: a webview view is resolved as
 * soon as its tab is revealed, so without this the user sees a blank rectangle and no hint that
 * the panel needs input. States what to do, in the same voice as the loaded view.
 *
 * Also used for the loading and error states every panel passes through on its way to real
 * content — those need the same theme-derived styling (and CSP that actually allows it) as this
 * steady-state placeholder, just with different treatment for the fact that they're transient:
 * `'loading'` shows a shimmering skeleton instead of literal text (a flash of "Loading X…" reads
 * as a stall; a shimmer reads as "something real is coming"), carrying the message as an
 * `aria-label` instead of visible text so screen readers still get it.
 */
export function renderPlaceholderHtml(message: string, opts: PlaceholderOptions): string {
  const styles = opts.styleUris.map((uri) => `<link rel="stylesheet" href="${uri}" />`).join('\n');
  const variant = opts.variant ?? 'empty';
  const body =
    variant === 'loading'
      ? `<div class="skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="${escapeHtml(message)}">
${SKELETON_ROW_WIDTHS.map((width) => `<div class="skeleton-row" style="width: ${width}"></div>`).join('\n')}
</div>`
      : `<p class="empty"${variant === 'error' ? ' role="alert"' : ''}>${escapeHtml(message)}</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource};" />
${styles}
</head>
<body>${body}</body>
</html>`;
}
