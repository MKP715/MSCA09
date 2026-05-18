import { render, pageHeader, esc, html, skeleton, emptyState, formatTimeRange, dayMonth } from '../ui.js';
import { getEvents } from '../data.js';
import { EVENT_CATEGORIES, SITE } from '../config.js';

let calendar = null;

export async function renderEvents({ query }) {
  document.title = 'Events — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Calendar',
      title: 'Events & Assemblies',
      lead: 'Area assemblies, workshops, committee meetings, and conventions — everything in one place.',
    })}

    <section class="section">
      <div class="container">
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
          <div class="btn-group" role="group" aria-label="View mode">
            <input type="radio" class="btn-check" name="evView" id="evView-list" autocomplete="off" checked />
            <label class="btn btn-outline-primary" for="evView-list"><i class="bi bi-list-ul me-1"></i>List</label>
            <input type="radio" class="btn-check" name="evView" id="evView-cal" autocomplete="off" />
            <label class="btn btn-outline-primary" for="evView-cal"><i class="bi bi-calendar3 me-1"></i>Calendar</label>
          </div>
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <div class="d-flex flex-wrap gap-1" id="categoryFilters">
              ${Object.entries(EVENT_CATEGORIES).map(([k, v]) => `
                <button type="button" class="btn btn-sm btn-outline-secondary cat-filter active" data-cat="${esc(k)}">
                  <span class="d-inline-block rounded-circle me-1" style="width:8px;height:8px;background:var(--bs-primary)"></span>${esc(v.label)}
                </button>
              `).join('')}
            </div>
            <input type="search" class="form-control form-control-sm search-input" id="eventSearch" placeholder="Search events…" data-page-search aria-label="Search events" style="min-width:220px" />
          </div>
        </div>

        <div id="eventsList" class="d-grid gap-3">${skeleton(5)}</div>
        <div id="eventsCal" class="d-none"></div>

        <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-5 pt-4 border-top">
          <div>
            <h5 class="mb-1">Have an event to share?</h5>
            <p class="small text-aa-muted mb-0">Submit assembly, workshop, or committee events for review.</p>
          </div>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" id="subscribeCal" class="btn btn-outline-primary">
              <i class="bi bi-calendar-plus me-1"></i>Subscribe (download .ics)
            </button>
            <a class="btn btn-primary" href="mailto:webmaster@msca09aa.org?subject=${encodeURIComponent('[MSCA09] Event submission')}&body=${encodeURIComponent('Please add the following event to the area calendar:\n\nTitle:\nDate:\nStart time:\nEnd time:\nLocation:\nAddress:\nDistrict:\nContact email:\nLink to flyer (if any):\nDescription:\n\nThanks!')}">
              <i class="bi bi-plus-circle me-1"></i>Submit an event
            </a>
          </div>
        </div>
      </div>
    </section>
  `);

  const all = await getEvents();
  const upcoming = all.filter((e) => e.start >= startOfToday());
  const past = all.filter((e) => e.start < startOfToday()).reverse();

  const state = {
    view: 'list',
    cats: new Set(Object.keys(EVENT_CATEGORIES)),
    search: '',
  };

  const list = document.getElementById('eventsList');
  const cal  = document.getElementById('eventsCal');

  function applyFilter(items) {
    const q = state.search.trim().toLowerCase();
    return items.filter((e) =>
      state.cats.has(e.category) &&
      (!q || `${e.title} ${e.location} ${e.description}`.toLowerCase().includes(q))
    );
  }

  function renderList() {
    const u = applyFilter(upcoming);
    const p = applyFilter(past).slice(0, 6);
    if (!u.length && !p.length) {
      list.innerHTML = emptyState('bi-calendar-x', 'No events match', 'Try clearing filters or adjusting your search.');
      return;
    }
    list.innerHTML = `
      ${u.length ? `<h4 class="mt-2">Upcoming</h4>${u.map(eventCard).join('')}` : ''}
      ${p.length ? `<h4 class="mt-4">Recent (past)</h4>${p.map(eventCard).join('')}` : ''}
    `;
  }

  function renderCal() {
    if (calendar) { calendar.render(); return; }
    calendar = new window.FullCalendar.Calendar(cal, {
      initialView: 'dayGridMonth',
      height: 'auto',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
      events: all.filter((e) => state.cats.has(e.category)).map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end || undefined,
        classNames: [EVENT_CATEGORIES[e.category]?.className || 'cat-other'],
        url: `#/events/${encodeURIComponent(e.id)}`,
      })),
      eventClick: (info) => {
        info.jsEvent.preventDefault();
        window.location.hash = `#/events/${encodeURIComponent(info.event.id)}`;
      },
    });
    calendar.render();
  }

  function refresh() {
    if (state.view === 'list') {
      cal.classList.add('d-none'); list.classList.remove('d-none');
      renderList();
    } else {
      list.classList.add('d-none'); cal.classList.remove('d-none');
      if (calendar) {
        calendar.removeAllEvents();
        all.filter((e) => state.cats.has(e.category)).forEach((e) => {
          calendar.addEvent({
            id: e.id,
            title: e.title,
            start: e.start,
            end: e.end || undefined,
            classNames: [EVENT_CATEGORIES[e.category]?.className || 'cat-other'],
            url: `#/events/${encodeURIComponent(e.id)}`,
          });
        });
      }
      renderCal();
    }
  }

  document.querySelectorAll('input[name="evView"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.view = r.id === 'evView-cal' ? 'cal' : 'list';
      refresh();
    });
  });
  document.querySelectorAll('.cat-filter').forEach((b) => {
    b.addEventListener('click', () => {
      const c = b.dataset.cat;
      if (state.cats.has(c)) { state.cats.delete(c); b.classList.remove('active'); }
      else { state.cats.add(c); b.classList.add('active'); }
      refresh();
    });
  });
  document.getElementById('eventSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    if (state.view === 'list') renderList();
  });

  if (query.get('view') === 'cal') {
    document.getElementById('evView-cal').checked = true;
    state.view = 'cal';
  }
  refresh();

  document.getElementById('subscribeCal').addEventListener('click', () => downloadAllAsIcs(upcoming));
}

function downloadAllAsIcs(events) {
  const dt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MSCA09//Events//EN', 'X-WR-CALNAME:MSCA09 Events'];
  events.forEach((e) => {
    const end = e.end || new Date(e.start.getTime() + 60 * 60 * 1000);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@msca09aa.org`);
    lines.push(`DTSTAMP:${dt(new Date())}`);
    lines.push(`DTSTART:${dt(e.start)}`);
    lines.push(`DTEND:${dt(end)}`);
    lines.push(`SUMMARY:${(e.title || '').replace(/[\n,;]/g, ' ')}`);
    if (e.location) lines.push(`LOCATION:${(e.location + (e.address ? ', ' + e.address : '')).replace(/[\n,;]/g, ' ')}`);
    if (e.description) lines.push(`DESCRIPTION:${(e.description).replace(/[\n,;]/g, ' ')}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'msca09-events.ics';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

function eventCard(e) {
  const d = dayMonth(e.start);
  const cat = EVENT_CATEGORIES[e.category] || EVENT_CATEGORIES.other;
  return `
    <a class="text-decoration-none text-reset" href="#/events/${encodeURIComponent(e.id)}">
      <div class="event-card" data-aos="fade-up">
        <div class="event-date">
          <span class="m">${d.month}</span>
          <span class="d">${d.day}</span>
          <span class="y">${d.year}</span>
        </div>
        <div class="flex-grow-1">
          <div class="d-flex flex-wrap align-items-center gap-2 small text-aa-muted">
            <span>${esc(formatTimeRange(e.start, e.end))}</span>
            ${e.location ? `<span>·</span><span>${esc(e.location)}</span>` : ''}
            ${e.district ? `<span class="badge text-bg-light">District ${esc(e.district)}</span>` : ''}
            <span class="badge text-bg-secondary">${esc(cat.label)}</span>
            ${e.featured ? `<span class="badge bg-gold">Featured</span>` : ''}
          </div>
          <h5 class="mt-1 mb-1">${esc(e.title)}</h5>
          ${e.description ? `<p class="text-aa-muted small mb-0">${esc(truncate(e.description, 160))}</p>` : ''}
        </div>
      </div>
    </a>
  `;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
