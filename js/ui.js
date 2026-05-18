/**
 * Shared UI utilities — DOM helpers, formatters, escaping.
 */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escape arbitrary text for safe interpolation into HTML. */
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Tagged template literal: safely interpolate values into HTML. */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (Array.isArray(v)) out += v.join('');
      else if (v == null || v === false) out += '';
      else out += esc(v);
    }
  });
  return out;
}

/** Render HTML into the main view outlet. */
export function render(viewHtml) {
  const view = document.getElementById('view');
  view.innerHTML = viewHtml;
  // Restart AOS animations for new view content
  if (window.AOS) window.AOS.refreshHard();
  // Move focus to top of main content for screen readers
  const main = document.getElementById('main');
  if (main) main.focus({ preventScroll: true });
}

/** Build a breadcrumb / page-header strip. */
export function pageHeader({ eyebrow, title, lead, breadcrumbs = [] }) {
  const crumbs = breadcrumbs
    .map((c, i) => i === breadcrumbs.length - 1
      ? `<li class="breadcrumb-item active" aria-current="page">${esc(c.label)}</li>`
      : `<li class="breadcrumb-item"><a href="${esc(c.href)}">${esc(c.label)}</a></li>`)
    .join('');
  return `
    <section class="bg-soft border-bottom">
      <div class="container py-4 py-md-5">
        ${breadcrumbs.length ? `<nav aria-label="breadcrumb"><ol class="breadcrumb small mb-3">${crumbs}</ol></nav>` : ''}
        ${eyebrow ? `<div class="eyebrow text-primary fw-semibold small text-uppercase mb-1">${esc(eyebrow)}</div>` : ''}
        <h1 class="display-6 fw-bold mb-2">${esc(title)}</h1>
        ${lead ? `<p class="lead text-aa-muted mb-0">${esc(lead)}</p>` : ''}
      </div>
    </section>
  `;
}

/** Show a Bootstrap-like loading skeleton in a container. */
export function skeleton(count = 3) {
  return Array.from({ length: count }).map(() => `
    <div class="placeholder-glow my-3">
      <span class="placeholder col-3"></span>
      <span class="placeholder col-7"></span>
      <span class="placeholder col-9"></span>
    </div>
  `).join('');
}

export function formatDateLong(date) {
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}
export function formatDateShort(date) {
  if (!date) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function formatTimeRange(start, end) {
  if (!start) return '';
  const fmt = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!end || end.getTime() === start.getTime()) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}
export function dayMonth(date) {
  return {
    month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    day:   date.getDate(),
    year:  date.getFullYear(),
  };
}

export function initials(name) {
  if (!name) return '??';
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase();
}

/** Empty-state placeholder. */
export function emptyState(icon, title, message) {
  return `
    <div class="text-center text-aa-muted py-5">
      <i class="bi ${esc(icon)}" style="font-size:2.5rem; opacity:0.5"></i>
      <h5 class="mt-3 mb-1">${esc(title)}</h5>
      <p class="mb-0">${esc(message)}</p>
    </div>
  `;
}
