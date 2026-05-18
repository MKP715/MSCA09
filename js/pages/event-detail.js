import { render, pageHeader, esc, formatDateLong, formatTimeRange, emptyState } from '../ui.js';
import { getEvents } from '../data.js';
import { EVENT_CATEGORIES } from '../config.js';

export async function renderEventDetail({ params }) {
  const id = decodeURIComponent(params.id || '');
  const events = await getEvents();
  const e = events.find((x) => x.id === id);

  if (!e) {
    document.title = 'Event not found — MSCA09';
    render(`
      ${pageHeader({ eyebrow: 'Event', title: 'Event not found', breadcrumbs: [{ label: 'Events', href: '#/events' }, { label: 'Not found' }] })}
      <section class="section">
        <div class="container">
          ${emptyState('bi-calendar-x', 'We couldn’t find that event', 'It may have been removed or the link is out of date.')}
          <div class="text-center"><a href="#/events" class="btn btn-primary">Back to events</a></div>
        </div>
      </section>
    `);
    return;
  }

  document.title = `${e.title} — MSCA09`;
  const cat = EVENT_CATEGORIES[e.category] || EVENT_CATEGORIES.other;
  const ics = buildIcs(e);
  const icsHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  const mapHref = e.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address)}` : '';

  render(`
    ${pageHeader({
      eyebrow: cat.label,
      title: e.title,
      lead: `${formatDateLong(e.start)} · ${formatTimeRange(e.start, e.end)}`,
      breadcrumbs: [{ label: 'Events', href: '#/events' }, { label: e.title }],
    })}

    <section class="section">
      <div class="container">
        <div class="row g-5">
          <div class="col-lg-8" data-aos="fade-up">
            ${e.description ? `<p class="lead">${esc(e.description)}</p>` : ''}
            ${e.flyer_url ? `
              <div class="mt-4">
                <a href="${esc(e.flyer_url)}" target="_blank" rel="noopener" class="btn btn-outline-primary">
                  <i class="bi bi-file-earmark-pdf me-1"></i>Download flyer
                </a>
              </div>` : ''}

            <div class="d-flex flex-wrap gap-2 mt-4">
              <a class="btn btn-primary" href="${icsHref}" download="${esc(safeFile(e.title))}.ics">
                <i class="bi bi-calendar-plus me-1"></i>Add to calendar
              </a>
              ${e.url ? `<a class="btn btn-outline-primary" href="${esc(e.url)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right me-1"></i>More info</a>` : ''}
              ${mapHref ? `<a class="btn btn-outline-primary" href="${esc(mapHref)}" target="_blank" rel="noopener"><i class="bi bi-geo-alt me-1"></i>Map</a>` : ''}
            </div>
          </div>
          <aside class="col-lg-4">
            <div class="card-soft p-4">
              <h6 class="mb-3">Details</h6>
              <dl class="row mb-0 small">
                <dt class="col-4 text-aa-muted">When</dt>
                <dd class="col-8">${esc(formatDateLong(e.start))}<br />${esc(formatTimeRange(e.start, e.end))}</dd>
                ${e.location ? `<dt class="col-4 text-aa-muted">Where</dt><dd class="col-8">${esc(e.location)}${e.address ? `<br /><span class="text-aa-muted">${esc(e.address)}</span>` : ''}</dd>` : ''}
                ${e.district ? `<dt class="col-4 text-aa-muted">District</dt><dd class="col-8">${esc(e.district)}</dd>` : ''}
                <dt class="col-4 text-aa-muted">Type</dt><dd class="col-8">${esc(cat.label)}</dd>
                ${e.contact ? `<dt class="col-4 text-aa-muted">Contact</dt><dd class="col-8">${maybeMail(e.contact)}</dd>` : ''}
              </dl>
            </div>
            <div class="text-center mt-3">
              <a href="#/events" class="link-secondary small"><i class="bi bi-arrow-left me-1"></i>Back to all events</a>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `);
}

function maybeMail(s) {
  if (/@/.test(s)) return `<a href="mailto:${esc(s)}">${esc(s)}</a>`;
  return esc(s);
}

function safeFile(s) { return s.replace(/[^a-z0-9]+/gi, '_').slice(0, 60).toLowerCase(); }

function buildIcs(e) {
  const dt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MSCA09//Events//EN',
    'BEGIN:VEVENT',
    `UID:${e.id}@msca09aa.org`,
    `DTSTAMP:${dt(new Date())}`,
    `DTSTART:${dt(e.start)}`,
    `DTEND:${dt(e.end || new Date(e.start.getTime() + 60 * 60 * 1000))}`,
    `SUMMARY:${(e.title || '').replace(/[\n,;]/g, ' ')}`,
    e.location ? `LOCATION:${(e.location + (e.address ? ', ' + e.address : '')).replace(/[\n,;]/g, ' ')}` : '',
    e.description ? `DESCRIPTION:${(e.description).replace(/[\n,;]/g, ' ')}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}
