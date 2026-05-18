import { render, pageHeader, esc } from '../ui.js';
import { SITE } from '../config.js';

export async function renderNewcomers() {
  document.title = 'Newcomers — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Newcomers',
      title: 'New to A.A.?',
      lead: 'You are not alone, and you do not have to do this alone. Here is what to expect, and how to find help today.',
    })}

    <section class="section">
      <div class="container">
        <div class="row g-5">
          <div class="col-lg-8" data-aos="fade-up">
            <div class="card-soft p-4 mb-4 border-start border-4 border-primary">
              <div class="d-flex gap-3 align-items-start">
                <i class="bi bi-telephone-fill text-primary fs-2"></i>
                <div>
                  <h5 class="mb-1">Need help right now?</h5>
                  <p class="mb-2 small text-aa-muted">A.A. members answer the hotline 24 hours a day. The call is confidential and free.</p>
                  <a class="btn btn-primary" href="tel:${SITE.hotline}"><i class="bi bi-telephone-fill me-1"></i>Call ${esc(SITE.hotlineDisplay)}</a>
                  <a class="btn btn-outline-primary ms-2" href="#/meetings"><i class="bi bi-search me-1"></i>Find a meeting</a>
                </div>
              </div>
            </div>

            <h2 class="h3">What is Alcoholics Anonymous?</h2>
            <p>
              Alcoholics Anonymous is a fellowship of people who share their experience, strength, and hope with each other
              so that they may solve their common problem and help others recover from alcoholism. The only requirement for
              membership is a desire to stop drinking. There are no dues or fees for A.A. membership.
            </p>

            <h2 class="h3 mt-5">What happens at a meeting?</h2>
            <ul>
              <li>Most meetings last about an hour and begin with a moment of reflection or the Serenity Prayer.</li>
              <li>One or more A.A. members may share their experience with alcoholism and recovery.</li>
              <li>You are welcome to listen — you do not have to speak. If you do share, only first names are used.</li>
              <li>If you mention you’re new, members will likely introduce themselves and offer support.</li>
              <li>There is no obligation, no commitment, and no cost to attend.</li>
            </ul>

            <h2 class="h3 mt-5">Frequently asked questions</h2>
            <div class="accordion" id="newcomerFaq">
              ${FAQ.map((f, i) => `
                <div class="accordion-item">
                  <h3 class="accordion-header">
                    <button class="accordion-button ${i===0?'':'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#faq${i}" aria-expanded="${i===0}">
                      ${esc(f.q)}
                    </button>
                  </h3>
                  <div id="faq${i}" class="accordion-collapse collapse ${i===0?'show':''}" data-bs-parent="#newcomerFaq">
                    <div class="accordion-body small text-aa-muted">${esc(f.a)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <aside class="col-lg-4" data-aos="fade-left">
            <div class="card-soft p-4">
              <h5 class="mb-3">The Twelve Steps</h5>
              <ol class="small mb-0">
                ${STEPS.map((s) => `<li class="mb-2">${esc(s)}</li>`).join('')}
              </ol>
            </div>

            <div class="card-soft p-4 mt-3">
              <h6 class="mb-2">More from A.A.</h6>
              <ul class="list-unstyled small mb-0">
                <li class="mb-2"><a target="_blank" rel="noopener" href="${esc(SITE.aaWorldUrl)}"><i class="bi bi-box-arrow-up-right me-1"></i>A.A. World Services</a> — official literature and FAQs</li>
                <li class="mb-2"><a target="_blank" rel="noopener" href="${esc(SITE.grapevineUrl)}"><i class="bi bi-box-arrow-up-right me-1"></i>A.A. Grapevine</a> — our international journal</li>
                <li><a target="_blank" rel="noopener" href="${esc(SITE.meetingFinderUrl)}"><i class="bi bi-box-arrow-up-right me-1"></i>Meeting Guide</a> — find meetings anywhere</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `);
}

const FAQ = [
  { q: 'Is A.A. religious?', a: 'A.A. is a spiritual program, not a religious one. Members come from every faith and from no faith at all. The only requirement for membership is a desire to stop drinking.' },
  { q: 'How much does it cost?', a: 'Nothing. A.A. has no dues or fees. Many groups pass a basket during meetings for voluntary contributions to cover rent and literature, but no contribution is required.' },
  { q: 'Will anyone know I came?', a: 'Anonymity is the spiritual foundation of all our traditions. What is shared at meetings stays at meetings, and members protect each other’s anonymity at the level of press, radio, and film.' },
  { q: 'Am I an alcoholic?', a: 'Only you can decide that. A.A. members were told the same thing when they came in. Many find that simply listening to others share is the beginning of an answer.' },
  { q: 'Do I have to speak?', a: 'No. You are welcome to listen for as long as you like. If you mention you are new, members will likely welcome you, but no one will pressure you to share.' },
];

const STEPS = [
  'We admitted we were powerless over alcohol — that our lives had become unmanageable.',
  'Came to believe that a Power greater than ourselves could restore us to sanity.',
  'Made a decision to turn our will and our lives over to the care of God as we understood Him.',
  'Made a searching and fearless moral inventory of ourselves.',
  'Admitted to God, to ourselves, and to another human being the exact nature of our wrongs.',
  'Were entirely ready to have God remove all these defects of character.',
  'Humbly asked Him to remove our shortcomings.',
  'Made a list of all persons we had harmed, and became willing to make amends to them all.',
  'Made direct amends to such people wherever possible, except when to do so would injure them or others.',
  'Continued to take personal inventory and when we were wrong promptly admitted it.',
  'Sought through prayer and meditation to improve our conscious contact with God as we understood Him, praying only for knowledge of His will for us and the power to carry that out.',
  'Having had a spiritual awakening as the result of these steps, we tried to carry this message to alcoholics, and to practice these principles in all our affairs.',
];
