import { render, pageHeader, esc, initials, emptyState } from '../ui.js';
import { getOfficers } from '../data.js';

const TYPE_LABELS = {
  officer: 'Area officers',
  chair:   'Committee chairs',
  dcm:     'District Committee Members (DCMs)',
};

export async function renderOfficers() {
  document.title = 'Trusted Servants — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Trusted Servants',
      title: 'Officers, chairs & DCMs',
      lead: 'Trusted servants of Area 09 — elected for a two-year rotation to serve the A.A. fellowship.',
    })}
    <section class="section">
      <div class="container">
        <div id="officersGroups"></div>
      </div>
    </section>
  `);

  const list = await getOfficers();
  const wrap = document.getElementById('officersGroups');
  if (!list.length) {
    wrap.innerHTML = emptyState('bi-person-badge', 'No officers listed', 'Trusted servants will appear here.');
    return;
  }
  const groups = list.reduce((acc, x) => {
    const k = TYPE_LABELS[x.type] ? x.type : 'officer';
    (acc[k] = acc[k] || []).push(x); return acc;
  }, {});

  wrap.innerHTML = ['officer', 'chair', 'dcm'].filter((k) => groups[k]).map((k) => `
    <h2 class="h4 mt-4 mb-3">${esc(TYPE_LABELS[k])}</h2>
    <div class="row g-3">
      ${groups[k].map((o) => `
        <div class="col-md-6 col-lg-4" data-aos="fade-up">
          <div class="person-card h-100">
            <div class="person-avatar" aria-hidden="true">${esc(initials(o.name))}</div>
            <div class="flex-grow-1">
              <div class="fw-semibold">${esc(o.name || '(Open position)')}</div>
              <div class="small text-aa-muted">${esc(o.position)}${o.district ? ` · District ${esc(o.district)}` : ''}</div>
              ${o.bio ? `<div class="small mt-2">${esc(o.bio)}</div>` : ''}
              ${o.email ? `<a class="small d-inline-block mt-2" href="mailto:${esc(o.email)}"><i class="bi bi-envelope me-1"></i>${esc(o.email)}</a>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}
