/**
 * Site-wide search modal.
 * Indexes events, officers, committees, districts, resources, meetings, and pages.
 * Opens via Cmd/Ctrl+K or the search trigger in the navbar.
 */
import { esc } from '../ui.js';
import { getEvents, getOfficers, getCommittees, getDistricts, getResources, getMeetings } from '../data.js';

const STATIC_PAGES = [
  { type: 'page', title: 'Home', url: '#/', keywords: 'home welcome msca09' },
  { type: 'page', title: 'About the Area', url: '#/about', keywords: 'about traditions structure' },
  { type: 'page', title: 'Events & Calendar', url: '#/events', keywords: 'events calendar assemblies' },
  { type: 'page', title: 'Find a Meeting', url: '#/meetings', keywords: 'meetings find groups' },
  { type: 'page', title: 'Districts', url: '#/districts', keywords: 'districts dcm' },
  { type: 'page', title: 'Service Committees', url: '#/service', keywords: 'service committees pi cpc treatment corrections accessibilities archives' },
  { type: 'page', title: 'Officers & Trusted Servants', url: '#/officers', keywords: 'officers trusted servants chair' },
  { type: 'page', title: 'Resources & Forms', url: '#/resources', keywords: 'resources minutes documents pdf forms' },
  { type: 'page', title: 'Newcomers', url: '#/newcomers', keywords: 'newcomers steps faq help' },
  { type: 'page', title: 'Contributions (7th Tradition)', url: '#/contributions', keywords: 'contributions seventh tradition donate self-support treasury' },
  { type: 'page', title: 'Twelve Concepts for World Service', url: '#/concepts', keywords: 'twelve concepts world service legacy' },
  { type: 'page', title: 'Contact the Area', url: '#/contact', keywords: 'contact webmaster email' },
];

let cachedIndex = null;

async function buildIndex() {
  if (cachedIndex) return cachedIndex;
  const [events, officers, committees, districts, resources, meetings] = await Promise.all([
    getEvents(), getOfficers(), getCommittees(), getDistricts(), getResources(), getMeetings(),
  ]);
  const idx = [];
  STATIC_PAGES.forEach((p) => idx.push({ ...p, _text: `${p.title} ${p.keywords}`.toLowerCase() }));
  events.forEach((e) => idx.push({
    type: 'event', title: e.title,
    sub: `${e.startDate}${e.location ? ' · ' + e.location : ''}`,
    url: `#/events/${encodeURIComponent(e.id)}`,
    _text: `${e.title} ${e.description} ${e.location} ${e.district}`.toLowerCase(),
  }));
  officers.forEach((o) => o.name && idx.push({
    type: 'person', title: o.name,
    sub: `${o.position}${o.district ? ' · District ' + o.district : ''}`,
    url: o.email ? `mailto:${o.email}` : '#/officers',
    _text: `${o.name} ${o.position} ${o.district}`.toLowerCase(),
  }));
  committees.forEach((c) => idx.push({
    type: 'committee', title: c.name, sub: c.purpose,
    url: '#/service',
    _text: `${c.name} ${c.purpose} ${c.chair}`.toLowerCase(),
  }));
  districts.forEach((d) => idx.push({
    type: 'district', title: `District ${d.number}${d.name ? ' — ' + d.name : ''}`,
    sub: d.area, url: '#/districts',
    _text: `district ${d.number} ${d.name} ${d.area} ${d.dcm}`.toLowerCase(),
  }));
  resources.forEach((r) => idx.push({
    type: 'resource', title: r.title, sub: r.category,
    url: r.url, external: /^https?:\/\//.test(r.url || ''),
    _text: `${r.title} ${r.description} ${r.category}`.toLowerCase(),
  }));
  meetings.forEach((m) => idx.push({
    type: 'meeting', title: m.name, sub: `${m.day} ${m.time} · ${m.city || m.address}`,
    url: '#/meetings',
    _text: `${m.name} ${m.day} ${m.time} ${m.city} ${m.address} ${m.types.join(' ')}`.toLowerCase(),
  }));
  cachedIndex = idx;
  return idx;
}

const TYPE_ICONS = {
  page:      'bi-file-earmark-text',
  event:     'bi-calendar-event',
  person:    'bi-person-badge',
  committee: 'bi-people-fill',
  district:  'bi-diagram-3',
  resource:  'bi-file-earmark-pdf',
  meeting:   'bi-geo-alt',
};
const TYPE_LABELS = {
  page: 'Page', event: 'Event', person: 'Person', committee: 'Committee',
  district: 'District', resource: 'Resource', meeting: 'Meeting',
};

export async function renderSiteSearch() {
  let modalEl = document.getElementById('siteSearchModal');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'siteSearchModal';
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    modalEl.setAttribute('aria-labelledby', 'siteSearchTitle');
    modalEl.innerHTML = `
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="siteSearchTitle"><i class="bi bi-search me-2"></i>Search MSCA09</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <input id="siteSearchInput" class="form-control form-control-lg mb-3" type="search" placeholder="Search events, people, resources…" autocomplete="off" />
            <div id="siteSearchHint" class="small text-aa-muted mb-2">
              Tip: press <span class="kbd-shortcut">↑</span><span class="kbd-shortcut">↓</span> to navigate, <span class="kbd-shortcut">Enter</span> to open, <span class="kbd-shortcut">Esc</span> to close.
            </div>
            <ul id="siteSearchResults" class="list-group list-group-flush list-hover"></ul>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
  }

  const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
  const input = modalEl.querySelector('#siteSearchInput');
  const results = modalEl.querySelector('#siteSearchResults');
  let active = -1;
  let current = [];

  const index = await buildIndex();

  function refresh() {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '';
      current = [];
      active = -1;
      return;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const scored = index
      .map((item) => {
        const score = tokens.reduce((s, t) => item._text.includes(t) ? s + 1 : s, 0);
        return { item, score };
      })
      .filter((r) => r.score === tokens.length)
      .slice(0, 30);
    current = scored.map((r) => r.item);
    active = current.length ? 0 : -1;
    results.innerHTML = current.length
      ? current.map((it, i) => itemHtml(it, i, q)).join('')
      : `<li class="list-group-item text-aa-muted text-center py-4">No matches for "${esc(input.value)}"</li>`;
    highlightActive();
  }

  function itemHtml(it, i, q) {
    return `
      <li class="list-group-item d-flex gap-3 align-items-start ${i===active?'active':''}" data-idx="${i}">
        <i class="bi ${TYPE_ICONS[it.type] || 'bi-link'} fs-5 text-primary mt-1"></i>
        <div class="flex-grow-1">
          <div class="d-flex justify-content-between gap-2">
            <strong>${esc(it.title)}</strong>
            <span class="badge text-bg-light text-uppercase small">${esc(TYPE_LABELS[it.type] || it.type)}</span>
          </div>
          ${it.sub ? `<div class="small text-aa-muted">${esc(it.sub)}</div>` : ''}
        </div>
      </li>
    `;
  }

  function highlightActive() {
    Array.from(results.children).forEach((li, i) => li.classList.toggle('active', i === active));
    const el = results.children[active];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function go(item) {
    if (!item) return;
    modal.hide();
    if (item.external) {
      window.open(item.url, '_blank', 'noopener');
    } else {
      window.location.hash = item.url;
    }
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, current.length - 1); highlightActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); highlightActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(current[active]); }
  });
  results.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-idx]');
    if (!li) return;
    go(current[parseInt(li.dataset.idx, 10)]);
  });

  modalEl.addEventListener('shown.bs.modal', () => { input.focus(); input.select(); }, { once: false });
  input.value = '';
  results.innerHTML = '';
  modal.show();
}
