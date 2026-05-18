import { render, pageHeader, esc, emptyState } from '../ui.js';
import { getCommittees } from '../data.js';

export async function renderService() {
  document.title = 'Service Committees — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Service',
      title: 'Service committees',
      lead: 'Standing committees of Area 09 carry the A.A. message through specialized service work. Newcomers to service are warmly welcomed.',
    })}
    <section class="section">
      <div class="container">
        <div id="committeesGrid" class="row g-3"></div>

        <div class="row g-3 mt-5" data-aos="fade-up">
          <div class="col-12"><h2 class="h4 mb-3">How to get involved</h2></div>
          <div class="col-md-4">
            <div class="card-soft p-4 h-100">
              <span class="icon-tile mb-3"><i class="bi bi-1-circle-fill"></i></span>
              <h6>Show up</h6>
              <p class="small text-aa-muted mb-0">Attend a committee meeting as an observer. Most committees meet monthly; schedules are listed above.</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card-soft p-4 h-100">
              <span class="icon-tile mb-3"><i class="bi bi-2-circle-fill"></i></span>
              <h6>Reach out</h6>
              <p class="small text-aa-muted mb-0">Email the committee chair to introduce yourself and ask how you can help. There is always something to do.</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card-soft p-4 h-100">
              <span class="icon-tile mb-3"><i class="bi bi-3-circle-fill"></i></span>
              <h6>Carry the message</h6>
              <p class="small text-aa-muted mb-0">Service positions are typically two-year commitments aligned with the General Service rotation.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `);

  const committees = await getCommittees();
  const grid = document.getElementById('committeesGrid');
  if (!committees.length) {
    grid.outerHTML = emptyState('bi-people', 'No committees listed', 'Committee details will appear here.');
    return;
  }
  grid.innerHTML = committees.map((c) => `
    <div class="col-md-6" data-aos="fade-up">
      <div class="card-soft p-4 h-100 d-flex gap-3">
        <span class="icon-tile"><i class="bi ${esc(c.icon || 'bi-people-fill')}"></i></span>
        <div class="flex-grow-1">
          <h5 class="mb-1">${esc(c.name)}</h5>
          <p class="small text-aa-muted mb-2">${esc(c.purpose)}</p>
          <dl class="row small mb-2">
            ${c.chair ? `<dt class="col-3 text-aa-muted">Chair</dt><dd class="col-9">${esc(c.chair)}</dd>` : ''}
            ${c.meeting_schedule ? `<dt class="col-3 text-aa-muted">Meets</dt><dd class="col-9">${esc(c.meeting_schedule)}</dd>` : ''}
          </dl>
          ${c.email ? `<a class="btn btn-sm btn-outline-primary" href="mailto:${esc(c.email)}"><i class="bi bi-envelope me-1"></i>Contact</a>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}
