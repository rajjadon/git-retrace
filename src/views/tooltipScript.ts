/**
 * Inline script text for GitLore's shared hover-tooltip mechanism, interpolated into every
 * webview's own `<script>` block — webviews are standalone documents with no cross-webview JS
 * module system, so the one shared source of truth is this TypeScript function, not a runtime
 * import; each view's rendered HTML still gets its own independent copy of the text.
 *
 * Native `title=""` tooltips have proven unreliable on some icon-only buttons in practice — this
 * renders one shared tooltip element GitLore fully controls instead, so it never depends on
 * whatever the host's native hover-bubbling happens to do. Pair with `.gitlore-tooltip` in
 * shared.css and `data-tooltip="..."` (not `title`) on any element that should show one.
 */
export function renderTooltipScript(): string {
  return `
const tooltip = document.createElement('div');
tooltip.className = 'gitlore-tooltip';
tooltip.setAttribute('role', 'tooltip');
document.body.appendChild(tooltip);

function positionTooltip(target) {
  const rect = target.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  let top = rect.top - tipRect.height - 6;
  if (top < 4) top = rect.bottom + 6;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
  tooltip.style.top = top + 'px';
  tooltip.style.left = left + 'px';
}

function showTooltip(target) {
  const text = target.dataset.tooltip;
  if (!text) return;
  tooltip.textContent = text;
  tooltip.classList.add('visible');
  positionTooltip(target);
}

function hideTooltip() {
  tooltip.classList.remove('visible');
}

for (const el of document.querySelectorAll('[data-tooltip]')) {
  el.addEventListener('mouseenter', () => showTooltip(el));
  el.addEventListener('focus', () => showTooltip(el));
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('blur', hideTooltip);
  el.addEventListener('click', hideTooltip);
}`;
}
