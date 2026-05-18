/**
 * MSCA09 — main application entry.
 * Boots router, page handlers, announcement bar, theme toggle, back-to-top.
 */

import { route, setNotFound, start, navigate } from './router.js';
import { getAnnouncements } from './data.js';
import { renderHome } from './pages/home.js';
import { renderAbout } from './pages/about.js';
import { renderEvents } from './pages/events.js';
import { renderEventDetail } from './pages/event-detail.js';
import { renderMeetings } from './pages/meetings.js';
import { renderDistricts } from './pages/districts.js';
import { renderService } from './pages/service.js';
import { renderOfficers } from './pages/officers.js';
import { renderResources } from './pages/resources.js';
import { renderNewcomers } from './pages/newcomers.js';
import { renderContact } from './pages/contact.js';
import { renderContributions } from './pages/contributions.js';
import { renderConcepts } from './pages/concepts.js';
import { renderNotFound } from './pages/not-found.js';

/* ---------- Routes ---------- */
route('/',           renderHome);
route('/about',      renderAbout);
route('/events',     renderEvents);
route('/events/:id', renderEventDetail);
route('/meetings',   renderMeetings);
route('/districts',  renderDistricts);
route('/service',    renderService);
route('/officers',   renderOfficers);
route('/resources',  renderResources);
route('/newcomers',     renderNewcomers);
route('/contact',       renderContact);
route('/contributions', renderContributions);
route('/concepts',      renderConcepts);
setNotFound(renderNotFound);

/* ---------- Theme (dark/light) ---------- */
const THEME_KEY = 'msca09:theme';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0c1426' : '#0b3d91');
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.innerHTML = theme === 'dark'
      ? '<i class="bi bi-sun-fill"></i>'
      : '<i class="bi bi-moon-stars-fill"></i>';
    btn.setAttribute('title', theme === 'dark' ? 'Switch to light' : 'Switch to dark');
  }
}
function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(stored || (prefersDark ? 'dark' : 'light'));
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

/* ---------- Announcement bar ---------- */
async function initAnnouncements() {
  try {
    const list = await getAnnouncements();
    if (!list.length) return;
    const top = list[0];
    const dismissedKey = `msca09:ann:dismissed:${top.id}`;
    if (sessionStorage.getItem(dismissedKey)) return;
    const bar = document.getElementById('announcementBar');
    const txt = document.getElementById('announcementText');
    if (!bar || !txt) return;
    const link = top.url
      ? `<a href="${top.url.startsWith('http') ? top.url : '#' + top.url}" class="alert-link">Read more →</a>`
      : '';
    txt.innerHTML = `<strong>${escapeText(top.title)}</strong> ${escapeText(top.body)} ${link}`;
    bar.classList.remove('d-none');
    document.getElementById('announcementDismiss')?.addEventListener('click', () => {
      bar.classList.add('d-none');
      sessionStorage.setItem(dismissedKey, '1');
    });
  } catch (err) {
    console.warn('[announcements] failed:', err);
  }
}
function escapeText(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

/* ---------- Back to top ---------- */
function initBackToTop() {
  const btn = document.getElementById('toTop');
  if (!btn) return;
  const onScroll = () => btn.classList.toggle('show', window.scrollY > 600);
  window.addEventListener('scroll', onScroll, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ---------- Footer year ---------- */
function initFooterYear() {
  const el = document.getElementById('footerYear');
  if (el) el.textContent = new Date().getFullYear();
}

/* ---------- Keyboard shortcuts ---------- */
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    // "/" focuses the page-level search input if present
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
      const search = document.querySelector('input[data-page-search]');
      if (search) { e.preventDefault(); search.focus(); return; }
    }
    // Cmd/Ctrl+K opens site search
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openSiteSearch();
    }
  });
  document.getElementById('siteSearchTrigger')?.addEventListener('click', openSiteSearch);
}

/* ---------- Auto-close mobile navbar on link click ---------- */
function initNavbarCollapse() {
  const collapseEl = document.getElementById('mainNav');
  if (!collapseEl) return;
  collapseEl.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#/"]');
    if (!link) return;
    if (window.innerWidth >= 992) return; // lg breakpoint
    const instance = window.bootstrap?.Collapse.getInstance(collapseEl);
    if (instance) instance.hide();
    else if (collapseEl.classList.contains('show')) {
      new window.bootstrap.Collapse(collapseEl, { toggle: false }).hide();
    }
  });
}

/* ---------- Site-wide search modal ---------- */
async function openSiteSearch() {
  const { renderSiteSearch } = await import('./pages/site-search.js');
  renderSiteSearch();
}

/* ---------- Boot ---------- */
initTheme();
initBackToTop();
initFooterYear();
initShortcuts();
initNavbarCollapse();
initAnnouncements();

// AOS — Animate On Scroll
if (window.AOS) window.AOS.init({ duration: 500, once: true, offset: 60, disable: 'mobile' });

start();

// Optional: expose navigate for inline use
window.MSCA09 = { navigate };
