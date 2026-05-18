import { render, pageHeader, esc, skeleton, emptyState } from '../ui.js';
import { getMeetings } from '../data.js';
import { SITE } from '../config.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function renderMeetings() {
  document.title = 'Find a Meeting — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Meetings',
      title: 'Find a meeting',
      lead: 'Search local A.A. meetings by day, city, or type. For a full regional finder, see the Meeting Guide.',
    })}

    <section class="section">
      <div class="container">
        <div class="row g-3 align-items-end mb-4" data-aos="fade-up">
          <div class="col-md-4">
            <label class="form-label small text-aa-muted" for="mDay">Day</label>
            <select id="mDay" class="form-select">
              <option value="">Any day</option>
              ${DAYS.map((d) => `<option>${d}</option>`).join('')}
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label small text-aa-muted" for="mCity">City</label>
            <select id="mCity" class="form-select"><option value="">Any city</option></select>
          </div>
          <div class="col-md-4">
            <label class="form-label small text-aa-muted" for="mSearch">Search</label>
            <input id="mSearch" type="search" class="form-control" placeholder="Group name, type, notes…" data-page-search />
          </div>
        </div>

        <div id="meetingsResults">${skeleton(5)}</div>

        <div class="alert alert-info mt-4 d-flex gap-3 align-items-start">
          <i class="bi bi-info-circle-fill mt-1"></i>
          <div>
            For the most comprehensive meeting search across Southern California (including online meetings),
            we recommend the <a href="${esc(SITE.meetingFinderUrl)}" target="_blank" rel="noopener" class="alert-link">Meeting Guide</a> app and website,
            maintained by A.A. World Services.
          </div>
        </div>
      </div>
    </section>
  `);

  const meetings = await getMeetings();
  const cities = Array.from(new Set(meetings.map((m) => m.city).filter(Boolean))).sort();
  const citySel = document.getElementById('mCity');
  citySel.innerHTML += cities.map((c) => `<option>${esc(c)}</option>`).join('');

  const daySel = document.getElementById('mDay');
  const search = document.getElementById('mSearch');

  function refresh() {
    const day = daySel.value;
    const city = citySel.value;
    const q = (search.value || '').toLowerCase().trim();
    const filtered = meetings.filter((m) => {
      if (day && m.day !== day) return false;
      if (city && m.city !== city) return false;
      if (q && !`${m.name} ${m.types.join(' ')} ${m.notes} ${m.address}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const results = document.getElementById('meetingsResults');
    if (!filtered.length) {
      results.innerHTML = emptyState('bi-search', 'No meetings match', 'Try removing a filter or searching the regional Meeting Guide.');
      return;
    }
    const byDay = groupBy(filtered, 'day');
    const days = DAYS.filter((d) => byDay[d]);
    results.innerHTML = days.map((d) => `
      <h4 class="mt-4 mb-2">${esc(d)}</h4>
      <div class="table-responsive">
        <table class="table table-soft align-middle list-hover">
          <thead><tr>
            <th style="width:90px">Time</th>
            <th>Group</th>
            <th class="d-none d-md-table-cell">Location</th>
            <th class="d-none d-md-table-cell">Types</th>
          </tr></thead>
          <tbody>
            ${byDay[d].sort((a,b) => sortTime(a.time, b.time)).map((m) => `
              <tr>
                <td class="text-nowrap small">${esc(m.time)}</td>
                <td>
                  <div class="fw-semibold">${esc(m.name)}</div>
                  <div class="small text-aa-muted d-md-none">${esc(m.address || '')} ${m.city ? '· ' + esc(m.city) : ''}</div>
                  ${m.notes ? `<div class="small text-aa-muted">${esc(m.notes)}</div>` : ''}
                </td>
                <td class="d-none d-md-table-cell small">
                  <div>${esc(m.address || '')}</div>
                  ${m.city ? `<div class="text-aa-muted">${esc(m.city)}</div>` : ''}
                </td>
                <td class="d-none d-md-table-cell">
                  ${m.types.map((t) => `<span class="badge text-bg-light me-1">${esc(t)}</span>`).join('')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  }

  daySel.addEventListener('change', refresh);
  citySel.addEventListener('change', refresh);
  search.addEventListener('input', refresh);
  refresh();
}

function groupBy(arr, key) {
  return arr.reduce((acc, x) => { (acc[x[key]] = acc[x[key]] || []).push(x); return acc; }, {});
}

function sortTime(a, b) {
  const t = (s) => {
    const m = (s || '').match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2] || '0', 10);
    const p = (m[3] || '').toLowerCase();
    if (p === 'pm' && h < 12) h += 12;
    if (p === 'am' && h === 12) h = 0;
    return h * 60 + mm;
  };
  return t(a) - t(b);
}
