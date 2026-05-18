import { render, pageHeader, esc } from '../ui.js';
import { SITE } from '../config.js';

export async function renderContact() {
  document.title = 'Contact — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Contact',
      title: 'Get in touch',
      lead: 'Send a message to the Area webmaster or a specific committee, or use the 24-hour hotline if you need help right now.',
    })}

    <section class="section">
      <div class="container">
        <div class="row g-5">
          <div class="col-lg-7" data-aos="fade-up">
            <form id="contactForm" class="card-soft p-4">
              <h5 class="mb-3">Send a message</h5>
              <p class="small text-aa-muted">
                This form opens your email client to send a message to the Area. Please do not include
                last names or other identifying information about A.A. members.
              </p>
              <div class="row g-3">
                <div class="col-md-6">
                  <label for="cName" class="form-label small">Your first name (optional)</label>
                  <input id="cName" class="form-control" type="text" autocomplete="given-name" />
                </div>
                <div class="col-md-6">
                  <label for="cEmail" class="form-label small">Your email <span class="text-danger">*</span></label>
                  <input id="cEmail" class="form-control" type="email" required autocomplete="email" />
                </div>
                <div class="col-12">
                  <label for="cTopic" class="form-label small">Topic</label>
                  <select id="cTopic" class="form-select">
                    <option>General question</option>
                    <option>Website / accessibility</option>
                    <option>Public Information</option>
                    <option>Cooperation with the Professional Community</option>
                    <option>Treatment / Corrections</option>
                    <option>Newcomer help</option>
                    <option>Event submission</option>
                  </select>
                </div>
                <div class="col-12">
                  <label for="cMsg" class="form-label small">Message <span class="text-danger">*</span></label>
                  <textarea id="cMsg" class="form-control" rows="6" required></textarea>
                </div>
                <div class="col-12 d-flex gap-2 flex-wrap">
                  <button type="submit" class="btn btn-primary"><i class="bi bi-envelope-fill me-1"></i>Send</button>
                  <button type="reset" class="btn btn-outline-secondary">Clear</button>
                </div>
              </div>
            </form>
          </div>

          <aside class="col-lg-5">
            <div class="card-soft p-4">
              <h5 class="mb-3">Reach the Area</h5>
              <dl class="row mb-0 small">
                <dt class="col-4 text-aa-muted">Webmaster</dt>
                <dd class="col-8"><a href="mailto:${esc(SITE.contactEmail)}">${esc(SITE.contactEmail)}</a></dd>
                <dt class="col-4 text-aa-muted">Hotline</dt>
                <dd class="col-8"><a href="tel:${esc(SITE.hotline)}">${esc(SITE.hotlineDisplay)}</a> <span class="text-aa-muted">(24h)</span></dd>
                <dt class="col-4 text-aa-muted">Legacy site</dt>
                <dd class="col-8"><a target="_blank" rel="noopener" href="${esc(SITE.legacyUrl)}">${esc(SITE.legacyUrl.replace(/^https?:\/\//, ''))}</a></dd>
              </dl>
            </div>

            <div class="card-soft p-4 mt-3">
              <h6 class="mb-2"><i class="bi bi-shield-lock-fill me-1 text-primary"></i>A note on anonymity</h6>
              <p class="small text-aa-muted mb-0">
                A.A. is built on the principle of anonymity. When you reach out, please share only what
                you are comfortable sharing. Our trusted servants protect your privacy.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `);

  document.getElementById('contactForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('cName').value.trim();
    const email = document.getElementById('cEmail').value.trim();
    const topic = document.getElementById('cTopic').value;
    const msg   = document.getElementById('cMsg').value.trim();
    const subject = `[MSCA09] ${topic}`;
    const body = `From: ${name || '(anonymous)'} <${email}>\n\n${msg}`;
    window.location.href = `mailto:${SITE.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}
