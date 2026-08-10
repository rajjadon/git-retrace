/** Small monochrome inline SVGs for webview chrome — `currentColor`-stroked so they follow the theme for free, with no icon-font/library dependency. */

/** Wraps a path body in a 16x16 `currentColor` SVG. `size` is in px; callers style position/opacity via `className`. */
function icon(body: string, className: string, size = 14): string {
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const FILE_BODY = '<path d="M4 1.5h5.5L13 5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z" /><path d="M9 1.5V5h4" />';

export const FILES_ICON = icon(FILE_BODY, 'section-icon');

export const DIFF_ICON = icon(
  '<path d="M5 2v9a2 2 0 0 0 2 2h4M5 2 2.5 4.5M5 2l2.5 2.5M11 14V5a2 2 0 0 0-2-2H5m6 11 2.5-2.5M11 14l-2.5-2.5" />',
  'section-icon',
);

/** Changes column: a file glyph next to the changed-file count. */
export const FILE_COUNT_ICON = icon(FILE_BODY, 'cell-icon', 12);

/** Local branch — the standard two-node-and-a-fork git glyph. */
export const BRANCH_ICON = icon(
  '<circle cx="4" cy="3.5" r="1.6" /><circle cx="4" cy="12.5" r="1.6" /><circle cx="12" cy="3.5" r="1.6" /><path d="M4 5.1v5.8M12 5.1v1.3a3 3 0 0 1-3 3H4" />',
  'ref-icon',
  12,
);

/** Remote-tracking branch — a cloud, matching how GitLens/VS Code signal "lives on the remote". */
export const REMOTE_ICON = icon(
  '<path d="M4.6 12.5h6.9a2.6 2.6 0 0 0 .3-5.18 3.6 3.6 0 0 0-6.7-1.1A2.95 2.95 0 0 0 4.6 12.5Z" />',
  'ref-icon',
  12,
);

/** Tag — a label with a punch hole. */
export const TAG_ICON = icon('<path d="M1.8 3.6h6.6l5.3 4.4-5.3 4.4H1.8z" /><circle cx="4.4" cy="8" r="0.9" />', 'ref-icon', 12);

export const SEARCH_ICON = icon('<circle cx="6.6" cy="6.6" r="4.3" /><path d="M9.8 9.8 14 14" />', 'toolbar-icon', 13);

export const REFRESH_ICON = icon('<path d="M13.4 8a5.4 5.4 0 1 1-1.86-4.08" /><path d="M13.6 2.2v3.2h-3.2" />', 'toolbar-icon', 13);

export const COPY_ICON = icon(
  '<rect x="5.6" y="5.6" width="8" height="8.8" rx="1" /><path d="M10.4 3.4H3.4a1 1 0 0 0-1 1v7" />',
  'toolbar-icon',
  13,
);

/** Pending-changes row marker — a dashed node, mirroring how GitLens draws the uncommitted row. */
export const PENDING_ICON = icon('<circle cx="8" cy="8" r="5.2" stroke-dasharray="2.4 2" />', 'ref-icon', 12);
