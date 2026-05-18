import { render, pageHeader, esc, emptyState } from '../ui.js';
import { getResources } from '../data.js';

export async function renderResources() {
  document.title = 'Resources — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Resources',
      title: 'Documents & resources',
      lead: 'Minutes, agendas, service guidelines, forms, and links to A.A. literature.',
    })}
    <section class="section">
      <div class="container">
        <div class="d-flex flex-wrap justify-content-between gap-3 mb-3" data-aos="fade-up">
          <div class="btn-group flex-wrap" role="group" id="resCategories"></div>
          <input id="resSearch" type="search" class="form-control search-input" placeholder="Search resources…" data-page-search style="max-width:260px;" />
        </div>
        <div id="resList"></div>
      </div>
    </section>
  `);

  const resources = await getResources();
  if (!resources.length) {
    document.getElementById('resList').innerHTML = emptyState('bi-folder', 'No resources yet', 'Files and links will appear here once posted.');
    return;
  }
  const cats = ['All', ...Array.from(new Set(resources.map((r) => r.category))).sort()];
  const catWrap = document.getElementById('resCategories');
  catWrap.innerHTML = cats.map((c, i) => `
    <button type="button" class="btn btn-sm btn-outline-primary ${i===0?'active':''}" data-cat="${esc(c)}">${esc(c)}</button>
  `).join('');

  const state = { cat: 'All', q: '' };
  catWrap.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]');
    if (!b) return;
    catWrap.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.cat = b.dataset.cat;
    refresh();
  });
  document.getElementById('resSearch').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); refresh(); });

  function refresh() {
    const filtered = resources.filter((r) =>
      (state.cat === 'All' || r.category === state.cat) &&
      (!state.q || `${r.title} ${r.description}`.toLowerCase().includes(state.q))
    );
    const wrap = document.getElementById('resList');
    if (!filtered.length) {
      wrap.innerHTML = emptyState('bi-search', 'Nothing matches', 'Try a different category or search term.');
      return;
    }
    const byCat = groupBy(filtered, 'category');
    wrap.innerHTML = Object.entries(byCat).map(([c, items]) => `
      <h4 class="mt-4 mb-2">${esc(c)}</h4>
      <div class="list-group list-group-flush list-hover">
        ${items.map((r) => `
          <a class="list-group-item bg-transparent px-0 d-flex gap-3 align-items-start" target="_blank" rel="noopener" href="${esc(r.url)}">
            <i class="bi ${esc(iconFor(r.url))} fs-4 text-primary mt-1"></i>
            <div class="flex-grow-1">
              <div class="fw-semibold">${esc(r.title)} <i class="bi bi-box-arrow-up-right small text-aa-muted ms-1"></i></div>
              ${r.description ? `<div class="small text-aa-muted">${esc(r.description)}</div>` : ''}
            </div>
            ${r.updated ? `<div class="small text-aa-muted text-nowrap">${esc(r.updated)}</div>` : ''}
          </a>
        `).join('')}
      </div>
    `).join('');
  }
  refresh();
}

function iconFor(url) {
  const u = (url || '').toLowerCase();
  if (u.endsWith('.pdf')) return 'bi-file-earmark-pdf-fill';
  if (u.match(/\.(docx?|odt)$/)) return 'bi-file-earmark-word-fill';
  if (u.match(/\.(xlsx?|csv|ods)$/)) return 'bi-file-earmark-spreadsheet-fill';
  if (u.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'bi-file-earmark-image-fill';
  if (u.includes('youtu')) return 'bi-youtube';
  if (u.includes('docs.google.com')) return 'bi-google';
  return 'bi-link-45deg';
}

function groupBy(arr, key) {
  return arr.reduce((acc, x) => { (acc[x[key]] = acc[x[key]] || []).push(x); return acc; }, {});
}
