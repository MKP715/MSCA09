import { render, pageHeader, esc, emptyState } from '../ui.js';
import { getDistricts } from '../data.js';

export async function renderDistricts() {
  document.title = 'Districts — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Districts',
      title: 'Districts of Area 09',
      lead: 'Districts bring service close to the groups. Each district elects a District Committee Member (DCM) who participates in the area.',
    })}
    <section class="section">
      <div class="container">
        <div id="districtsGrid" class="row g-3"></div>
        <div class="alert alert-light border mt-5">
          <div class="d-flex gap-3 align-items-start">
            <i class="bi bi-diagram-3-fill text-primary fs-3"></i>
            <div>
              <h6 class="mb-1">What is a district?</h6>
              <p class="mb-0 small text-aa-muted">
                A district is a geographic grouping of A.A. groups within an area. The DCM serves as
                a two-way communication link between groups and the area, and supports the General
                Service Representatives (GSRs) of the groups in their district.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `);

  const list = await getDistricts();
  const grid = document.getElementById('districtsGrid');
  if (!list.length) {
    grid.outerHTML = emptyState('bi-diagram-3', 'No districts available', 'District information will appear here.');
    return;
  }
  grid.innerHTML = list.map((d) => `
    <div class="col-md-6 col-lg-4" data-aos="fade-up">
      <div class="card-soft p-4 h-100">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <div class="small text-aa-muted">District</div>
            <h3 class="h2 mb-0">${esc(d.number || '–')}</h3>
          </div>
          <span class="icon-tile"><i class="bi bi-geo-alt-fill"></i></span>
        </div>
        ${d.name ? `<h5 class="mb-2">${esc(d.name)}</h5>` : ''}
        ${d.area ? `<p class="small text-aa-muted mb-2">${esc(d.area)}</p>` : ''}
        ${d.dcm ? `<div class="small"><span class="text-aa-muted">DCM:</span> <strong>${esc(d.dcm)}</strong></div>` : ''}
        ${d.meeting_info ? `<div class="small text-aa-muted mt-1">${esc(d.meeting_info)}</div>` : ''}
        <div class="d-flex gap-2 mt-3">
          ${d.email ? `<a class="btn btn-sm btn-outline-primary" href="mailto:${esc(d.email)}"><i class="bi bi-envelope me-1"></i>Contact</a>` : ''}
          ${d.website ? `<a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="${esc(d.website)}"><i class="bi bi-box-arrow-up-right me-1"></i>Website</a>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}
