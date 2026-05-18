/**
 * Tiny hash-based SPA router.
 * Hash routing means GitHub Pages serves index.html for every URL
 * without needing rewrites or a backend.
 *
 * Routes are registered as { pattern: '/path/:param', handler }.
 */

const routes = [];
let notFound = null;

function compile(pattern) {
  const keys = [];
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/\/+$/, '')
        .replace(/:[A-Za-z_]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; })
        .replace(/\*/g, '.*') +
      '/?$'
  );
  return { regex, keys };
}

export function route(pattern, handler) {
  routes.push({ pattern, handler, ...compile(pattern) });
}

export function setNotFound(handler) { notFound = handler; }

export function currentPath() {
  const h = window.location.hash || '#/';
  return h.replace(/^#/, '').split('?')[0] || '/';
}

export function currentQuery() {
  const h = window.location.hash || '';
  const i = h.indexOf('?');
  if (i < 0) return new URLSearchParams();
  return new URLSearchParams(h.slice(i + 1));
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

async function dispatch() {
  const path = currentPath();
  const query = currentQuery();
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] || ''); });
      try {
        await r.handler({ path, params, query });
      } catch (err) {
        console.error('[router] handler error:', err);
        const view = document.getElementById('view');
        if (view) {
          view.innerHTML = `<div class="container py-5"><div class="alert alert-danger">Something went wrong rendering this page. Please try again later.</div></div>`;
        }
      }
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      updateActiveNav(path);
      return;
    }
  }
  if (notFound) await notFound({ path });
}

function updateActiveNav(path) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    const r = el.getAttribute('data-route');
    const isHome = (r === '/' && path === '/');
    const matches = r !== '/' && path.startsWith(r);
    el.classList.toggle('active', isHome || matches);
  });
}

export function start() {
  window.addEventListener('hashchange', dispatch);
  window.addEventListener('DOMContentLoaded', dispatch);
  if (document.readyState !== 'loading') dispatch();
}
