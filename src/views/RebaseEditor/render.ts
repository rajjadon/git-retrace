import type { RebaseEntry } from '../../core/git/rebaseTodo';
import { escapeHtml } from '../escapeHtml';
import { CHECK_ICON, CHEVRON_DOWN_ICON, CHEVRON_UP_ICON, DRAG_HANDLE_ICON } from '../icons';

export interface RenderRebaseEditorOptions {
  nonce: string;
  cspSource: string;
  /** Stylesheets to link, in order. Shared rules first, then the panel's own. */
  styleUris: string[];
}

export interface RebaseEditorData {
  entries: RebaseEntry[];
}

const ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'] as const;

function renderRow(entry: RebaseEntry, index: number, lastIndex: number): string {
  if (!entry.editable) {
    return `<div class="rb-row rb-row-raw" role="listitem">
<span class="rb-raw-text">${escapeHtml(entry.raw)}</span>
</div>`;
  }

  const options = ACTIONS.map(
    (action) => `<option value="${action}"${action === entry.command ? ' selected' : ''}>${action}</option>`,
  ).join('');

  return `<div class="rb-row rb-row-${escapeHtml(entry.command)}" role="listitem" draggable="true" data-index="${index}" data-sha="${escapeHtml(entry.sha)}">
<span class="rb-drag-handle" aria-hidden="true">${DRAG_HANDLE_ICON}</span>
<span class="rb-move">
<button class="icon-btn rb-move-up" type="button" data-index="${index}"${index === 0 ? ' disabled' : ''} aria-label="Move up">${CHEVRON_UP_ICON}</button>
<button class="icon-btn rb-move-down" type="button" data-index="${index}"${index === lastIndex ? ' disabled' : ''} aria-label="Move down">${CHEVRON_DOWN_ICON}</button>
</span>
<select class="rb-action" data-index="${index}" aria-label="Action for ${escapeHtml(entry.sha)}">${options}</select>
<code class="rb-sha">${escapeHtml(entry.sha)}</code>
<span class="rb-message" title="${escapeHtml(entry.message)}">${escapeHtml(entry.message)}</span>
</div>`;
}

/** Builds the Interactive Rebase Editor's full HTML document. Pure — unit-testable without a real webview host, same convention as the other views. */
export function renderRebaseEditorHtml(data: RebaseEditorData, opts: RenderRebaseEditorOptions): string {
  const { entries } = data;
  const editableCount = entries.filter((e) => e.editable).length;
  const styles = opts.styleUris.map((uri) => `<link rel="stylesheet" href="${uri}" />`).join('\n');
  const rows = entries.map((entry, i) => renderRow(entry, i, entries.length - 1)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; script-src 'nonce-${opts.nonce}';" />
${styles}
<title>Interactive Rebase</title>
</head>
<body>
<div class="rb-toolbar">
<span class="rb-summary">${editableCount} ${editableCount === 1 ? 'commit' : 'commits'} to rebase</span>
</div>
<div class="rb-rows" id="rows" role="list">
${rows}
</div>
<div class="rb-actions">
<button class="btn btn-accent" id="start-rebase" type="button">${CHECK_ICON}Start Rebase</button>
<button class="btn" id="abort-rebase" type="button">Abort</button>
</div>
<script nonce="${opts.nonce}">
const vscode = acquireVsCodeApi();
const rowsEl = document.getElementById('rows');

// Every drag-drop reorder sends a document edit, which re-renders this whole webview.html from
// scratch — tearing down all in-memory JS state. vscode.setState()/getState() is the only channel
// that survives that, so the pre-move row positions captured in the 'drop' handler below are
// bridged through it to this fresh script instance, which applies the FLIP transform on load.
const previousState = vscode.getState();
if (previousState?.flipPositions) {
  for (const row of rowsEl.querySelectorAll('.rb-row[data-sha]')) {
    const before = previousState.flipPositions[row.dataset.sha];
    if (before === undefined) {
      continue;
    }
    const after = row.getBoundingClientRect().top;
    const delta = before - after;
    if (delta === 0) {
      continue;
    }
    row.style.transition = 'none';
    row.style.transform = \`translateY(\${delta}px)\`;
    // Force a layout flush so the browser registers the starting transform before the
    // transition below is applied — otherwise it would just jump straight to the end state.
    row.getBoundingClientRect();
    row.style.transition = 'transform var(--gitlore-motion)';
    row.style.transform = '';
  }
  vscode.setState({});
}

function reorder(from, to) {
  vscode.postMessage({ type: 'reorder', from, to });
}

rowsEl.addEventListener('click', (e) => {
  const upBtn = e.target.closest('.rb-move-up');
  const downBtn = e.target.closest('.rb-move-down');
  if (upBtn && !upBtn.disabled) {
    reorder(Number(upBtn.dataset.index), Number(upBtn.dataset.index) - 1);
  } else if (downBtn && !downBtn.disabled) {
    reorder(Number(downBtn.dataset.index), Number(downBtn.dataset.index) + 1);
  }
});

rowsEl.addEventListener('change', (e) => {
  const select = e.target.closest('.rb-action');
  if (select) {
    vscode.postMessage({ type: 'setAction', index: Number(select.dataset.index), action: select.value });
  }
});

let draggedIndex = null;
for (const row of rowsEl.querySelectorAll('.rb-row[draggable="true"]')) {
  row.addEventListener('dragstart', () => {
    draggedIndex = Number(row.dataset.index);
    row.classList.add('rb-dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('rb-dragging'));
  row.addEventListener('dragover', (e) => e.preventDefault());
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const to = Number(row.dataset.index);
    if (draggedIndex !== null && draggedIndex !== to) {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const positions = {};
        for (const r of rowsEl.querySelectorAll('.rb-row[data-sha]')) {
          positions[r.dataset.sha] = r.getBoundingClientRect().top;
        }
        vscode.setState({ flipPositions: positions });
      }
      reorder(draggedIndex, to);
    }
    draggedIndex = null;
  });
}

document.getElementById('start-rebase').addEventListener('click', () => {
  vscode.postMessage({ type: 'startRebase' });
});
document.getElementById('abort-rebase').addEventListener('click', () => {
  vscode.postMessage({ type: 'abortRebase' });
});
</script>
</body>
</html>`;
}
