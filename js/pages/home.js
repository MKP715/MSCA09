import { render, html, esc, formatDateLong, formatTimeRange, dayMonth, skeleton } from '../ui.js';
import { getEvents, getCommittees, getDistricts } from '../data.js';
import { SITE } from '../config.js';

export async function renderHome() {
  document.title = `${SITE.name} — ${SITE.fullName}`;

  render(`
    <!-- Hero -->
    <section class="hero">
      <div class="container">
        <div class="row align-items-center g-5">
          <div class="col-lg-7" data-aos="fade-up">
            <h1>
              <small>Mid-Southern California · Area 09</small>
              The hand of A.A. is here when anyone, anywhere reaches out.
            </h1>
            <p class="lead mt-3">
              MSCA09 carries the message of recovery to the alcoholic who still suffers through the
              General Service structure of Alcoholics Anonymous.
            </p>
            <div class="d-flex flex-wrap gap-2 mt-4">
              <a href="#/meetings" class="btn btn-gold btn-lg" style="background:var(--aa-gold-500); color:var(--aa-blue-900); font-weight:600;">
                <i class="bi bi-search me-2"></i>Find a Meeting
              </a>
              <a href="#/newcomers" class="btn btn-outline-light btn-lg">
                <i class="bi bi-heart me-2"></i>New to A.A.?
              </a>
              <a href="#/events" class="btn btn-outline-light btn-lg">
                <i class="bi bi-calendar3 me-2"></i>Upcoming Events
              </a>
            </div>
          </div>
          <div class="col-lg-5" data-aos="fade-left">
            <div class="row g-3">
              <div class="col-6"><div class="hero-stat"><div class="num" id="statDistricts">—</div><div class="small text-white-50">Active districts</div></div></div>
              <div class="col-6"><div class="hero-stat"><div class="num" id="statEvents">—</div><div class="small text-white-50">Upcoming events</div></div></div>
              <div class="col-12">
                <div class="hero-stat">
                  <div class="d-flex align-items-start gap-3">
                    <i class="bi bi-telephone-fill text-gold" style="font-size:1.5rem"></i>
                    <div>
                      <div class="fw-semibold">24-Hour Hotline</div>
                      <a class="link-light h5 mb-0 d-block" href="tel:${SITE.hotline}">${esc(SITE.hotlineDisplay)}</a>
                      <div class="small text-white-50">Confidential. Anytime. Anywhere.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Quick find -->
    <section class="section">
      <div class="container">
        <div class="section-title text-center" data-aos="fade-up">
          <div class="eyebrow">How can we help?</div>
          <h2 class="display-6 fw-bold">Quick links</h2>
        </div>
        <div class="quickfind" data-aos="fade-up">
          <a href="#/meetings"><span class="icon-tile"><i class="bi bi-geo-alt-fill"></i></span><div><strong>Find a meeting</strong><div class="small text-aa-muted">Search by day, time, or city.</div></div></a>
          <a href="#/events"><span class="icon-tile"><i class="bi bi-calendar-event-fill"></i></span><div><strong>Calendar</strong><div class="small text-aa-muted">Assemblies, workshops, conventions.</div></div></a>
          <a href="#/districts"><span class="icon-tile"><i class="bi bi-diagram-3-fill"></i></span><div><strong>Districts</strong><div class="small text-aa-muted">DCMs and area structure.</div></div></a>
          <a href="#/service"><span class="icon-tile"><i class="bi bi-people-fill"></i></span><div><strong>Service committees</strong><div class="small text-aa-muted">Get involved in carrying the message.</div></div></a>
          <a href="#/resources"><span class="icon-tile"><i class="bi bi-file-earmark-text-fill"></i></span><div><strong>Resources &amp; forms</strong><div class="small text-aa-muted">Minutes, agendas, guidelines.</div></div></a>
          <a href="#/newcomers"><span class="icon-tile"><i class="bi bi-heart-fill"></i></span><div><strong>Newcomers</strong><div class="small text-aa-muted">What is A.A.? How does it work?</div></div></a>
        </div>
      </div>
    </section>

    <!-- Upcoming events -->
    <section class="section bg-soft border-top border-bottom">
      <div class="container">
        <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
          <div>
            <div class="eyebrow text-primary fw-semibold small text-uppercase">Mark your calendar</div>
            <h2 class="display-6 fw-bold mb-0">Upcoming events</h2>
          </div>
          <a href="#/events" class="btn btn-outline-primary">View calendar <i class="bi bi-arrow-right ms-1"></i></a>
        </div>
        <div id="homeEvents" class="row g-3">
          ${skeleton(4)}
        </div>
      </div>
    </section>

    <!-- Service callout -->
    <section class="section">
      <div class="container">
        <div class="row g-4 align-items-center">
          <div class="col-md-6" data-aos="fade-right">
            <div class="eyebrow text-primary fw-semibold small text-uppercase">Service is the heart of A.A.</div>
            <h2 class="display-6 fw-bold">Carry the message</h2>
            <p class="text-aa-muted">
              Area 09 is staffed entirely by trusted servants — A.A. members who give their time so that
              the hand of A.A. is always there when anyone reaches out. There is a place for everyone.
            </p>
            <div class="d-flex gap-2 flex-wrap">
              <a href="#/service" class="btn btn-primary">Explore committees</a>
              <a href="#/officers" class="btn btn-outline-primary">Meet the trusted servants</a>
            </div>
          </div>
          <div class="col-md-6" data-aos="fade-left">
            <div id="homeCommittees" class="row g-3">${skeleton(3)}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Responsibility Pledge -->
    <section class="section" style="background:linear-gradient(135deg, var(--aa-blue-900), var(--aa-blue-800)); color:#fff;">
      <div class="container text-center" data-aos="fade-up">
        <div class="eyebrow text-gold small fw-semibold text-uppercase" style="letter-spacing:0.18em;">The Responsibility Declaration</div>
        <p class="display-5 mt-3" style="font-family: var(--bs-font-serif); max-width:48ch; margin:0 auto; color:#fff;">
          "I am responsible. When anyone, anywhere, reaches out for help, I want the hand of A.A. always to be there. And for that: I am responsible."
        </p>
        <p class="mt-3 mb-0 small text-white-50">Adopted at the 1965 International Convention, Toronto</p>
      </div>
    </section>

    <!-- Tradition / quote -->
    <section class="section bg-soft border-top">
      <div class="container text-center" data-aos="fade-up">
        <i class="bi bi-quote display-3 text-gold"></i>
        <blockquote class="blockquote">
          <p class="display-6 fw-normal" style="font-family: var(--bs-font-serif); max-width:50ch; margin:0 auto;">
            "Our common welfare should come first; personal recovery depends upon A.A. unity."
          </p>
          <footer class="blockquote-footer mt-3">Tradition One — <cite>The Twelve Steps and Twelve Traditions</cite></footer>
        </blockquote>
      </div>
    </section>
  `);

  // Populate dynamic content
  populateUpcoming();
  populateCommittees();
  populateDistrictStat();
}

async function populateDistrictStat() {
  try {
    const districts = await getDistricts();
    const el = document.getElementById('statDistricts');
    if (el) el.textContent = String(districts.length);
  } catch (_) { /* leave dash */ }
}

async function populateUpcoming() {
  const wrap = document.getElementById('homeEvents');
  if (!wrap) return;
  try {
    const events = (await getEvents({ upcomingOnly: true })).slice(0, 4);
    const statEvents = document.getElementById('statEvents');
    if (statEvents) statEvents.textContent = String((await getEvents({ upcomingOnly: true })).length);
    if (!events.length) {
      wrap.innerHTML = `<div class="col-12"><div class="alert alert-info mb-0">No upcoming events posted yet. Check back soon, or browse the full <a href="#/events">calendar</a>.</div></div>`;
      return;
    }
    wrap.innerHTML = events.map((e) => {
      const d = dayMonth(e.start);
      return `
        <div class="col-md-6" data-aos="fade-up">
          <a class="text-decoration-none text-reset" href="#/events/${encodeURIComponent(e.id)}">
            <div class="event-card">
              <div class="event-date">
                <span class="m">${d.month}</span>
                <span class="d">${d.day}</span>
                <span class="y">${d.year}</span>
              </div>
              <div class="flex-grow-1">
                <div class="small text-aa-muted">${esc(formatTimeRange(e.start, e.end))}${e.location ? ' · ' + esc(e.location) : ''}</div>
                <h5 class="mb-1">${esc(e.title)}</h5>
                ${e.district ? `<div class="small"><span class="badge text-bg-light">District ${esc(e.district)}</span></div>` : ''}
              </div>
            </div>
          </a>
        </div>`;
    }).join('');
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="col-12"><div class="alert alert-warning">Could not load events.</div></div>`;
  }
}

async function populateCommittees() {
  const wrap = document.getElementById('homeCommittees');
  if (!wrap) return;
  try {
    const committees = (await getCommittees()).slice(0, 4);
    if (!committees.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = committees.map((c) => `
      <div class="col-12">
        <div class="card-soft p-3 d-flex gap-3 align-items-start">
          <span class="icon-tile"><i class="bi ${esc(c.icon || 'bi-people-fill')}"></i></span>
          <div>
            <h6 class="mb-1">${esc(c.name)}</h6>
            <div class="small text-aa-muted mb-0">${esc(c.purpose)}</div>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    wrap.innerHTML = '';
  }
}
