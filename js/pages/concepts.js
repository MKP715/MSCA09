import { render, pageHeader, esc } from '../ui.js';

export async function renderConcepts() {
  document.title = 'Twelve Concepts — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Service legacy',
      title: 'The Twelve Concepts for World Service',
      lead: 'Written by Bill W. in 1962 and adopted by the General Service Conference, the Concepts describe how A.A.’s service structure functions — the principles by which trusted servants serve.',
    })}

    <section class="section">
      <div class="container">
        <div class="row g-5">
          <div class="col-lg-8" data-aos="fade-up">
            <p>
              Together with the <a href="#/newcomers">Twelve Steps</a> and the
              <a href="#/about">Twelve Traditions</a>, the Twelve Concepts form
              A.A.'s three legacies — Recovery, Unity, and Service. The Concepts
              ensure that the spirit of A.A. as a fellowship is preserved as
              decisions are made on its behalf.
            </p>

            <div class="accordion mt-4" id="conceptsAcc">
              ${CONCEPTS.map((c, i) => `
                <div class="accordion-item">
                  <h3 class="accordion-header">
                    <button class="accordion-button ${i===0?'':'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#concept${i}" aria-expanded="${i===0}">
                      <strong class="me-2">${i + 1}.</strong> ${esc(c.short)}
                    </button>
                  </h3>
                  <div id="concept${i}" class="accordion-collapse collapse ${i===0?'show':''}" data-bs-parent="#conceptsAcc">
                    <div class="accordion-body small">
                      <p class="mb-1">${esc(c.text)}</p>
                      ${c.note ? `<p class="small text-aa-muted mb-0"><em>${esc(c.note)}</em></p>` : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <aside class="col-lg-4">
            <div class="card-soft p-4">
              <h6 class="mb-2"><i class="bi bi-book-half me-1 text-primary"></i>Read the full text</h6>
              <p class="small text-aa-muted mb-2">The Twelve Concepts are explored in depth in the A.A. Service Manual / Twelve Concepts for World Service.</p>
              <a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="https://www.aa.org/sites/default/files/literature/en_aaservicemanual.pdf">
                <i class="bi bi-file-earmark-pdf me-1"></i>A.A. Service Manual (PDF)
              </a>
            </div>
            <div class="card-soft p-4 mt-3">
              <h6 class="mb-2">Three legacies</h6>
              <ul class="list-unstyled small mb-0">
                <li class="mb-2"><span class="badge bg-primary me-1">Recovery</span> <a href="#/newcomers">The Twelve Steps</a></li>
                <li class="mb-2"><span class="badge bg-primary me-1">Unity</span> <a href="#/about">The Twelve Traditions</a></li>
                <li><span class="badge bg-primary me-1">Service</span> The Twelve Concepts <em>(this page)</em></li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `);
}

const CONCEPTS = [
  { short: 'Ultimate responsibility', text: 'Final responsibility and ultimate authority for A.A. world services should always reside in the collective conscience of our whole Fellowship.' },
  { short: 'Delegation through the Conference', text: 'The General Service Conference of A.A. has become, for nearly every practical purpose, the active voice and the effective conscience of our whole Society in its world affairs.' },
  { short: 'The Right of Decision', text: 'To insure effective leadership, we should endow each element of A.A. — the Conference, the General Service Board and its service corporations, staffs, committees, and executives — with a traditional "Right of Decision."' },
  { short: 'The Right of Participation', text: 'At all responsible levels, we ought to maintain a traditional "Right of Participation," allowing a voting representation in reasonable proportion to the responsibility that each must discharge.' },
  { short: 'The Right of Appeal', text: 'Throughout our structure, a traditional "Right of Appeal" ought to prevail, so that minority opinion will be heard and personal grievances receive careful consideration.' },
  { short: 'The Conference acts for A.A.', text: 'The Conference recognizes that the chief initiative and active responsibility in most world service matters should be exercised by the trustee members of the Conference acting as the General Service Board.' },
  { short: 'The Charter and Bylaws', text: 'The Charter and Bylaws of the General Service Board are legal instruments, empowering the trustees to manage and conduct world service affairs. The Conference Charter is not a legal document; it relies upon tradition and the A.A. purse for final effectiveness.' },
  { short: 'The trustees, custodians', text: 'The trustees are the principal planners and administrators of overall policy and finance. They have custodial oversight of the separately incorporated and constantly active services, exercising this through their ability to elect all the directors of these entities.' },
  { short: 'Good service leadership', text: 'Good service leadership at all levels is indispensable for our future functioning and safety. Primary world service leadership, once exercised by the founders, must necessarily be assumed by the trustees.' },
  { short: 'Service responsibility and authority', text: 'Every service responsibility should be matched by an equal service authority — the scope of such authority being always well defined, whether by tradition, by resolution, by specific job description, or by appropriate charters and bylaws.' },
  { short: 'Trustee committees & paid staff', text: 'The trustees should always have the best possible committees, corporate service directors, executives, staffs, and consultants. Composition, qualifications, induction procedures, and rights and duties will always be matters of serious concern.' },
  { short: 'General Warranties of the Conference', text: 'The Conference shall observe the spirit of A.A. tradition, taking care that it never becomes the seat of perilous wealth or power; that sufficient operating funds plus an ample reserve be its prudent financial principle; that it place none of its members in a position of unqualified authority over others; that it reach all important decisions by discussion, vote, and whenever possible by substantial unanimity; that its actions never be personally punitive nor an incitement to public controversy; that, though it may act for the service of A.A., it shall never perform any acts of government; and that, like the Society it serves, it will always remain democratic in thought and action.' },
];
