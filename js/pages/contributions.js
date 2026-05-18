import { render, pageHeader, esc } from '../ui.js';
import { SITE } from '../config.js';

export async function renderContributions() {
  document.title = 'Contributions — MSCA09';

  render(`
    ${pageHeader({
      eyebrow: 'Seventh Tradition',
      title: 'Contributions',
      lead: 'Alcoholics Anonymous is fully self-supporting through the contributions of its members — declining contributions from outside our fellowship.',
    })}

    <section class="section">
      <div class="container">
        <div class="row g-5">
          <div class="col-lg-8" data-aos="fade-up">
            <p>
              <em>"Every A.A. group ought to be fully self-supporting, declining outside contributions." — Tradition Seven</em>
            </p>
            <p>
              Voluntary contributions from A.A. members and groups fund every level of A.A. service —
              from the local group rent to the worldwide carrying of the message through the General
              Service Office. Contributions are voluntary; no member is obligated to contribute.
            </p>

            <h2 class="h4 mt-5">Where contributions go</h2>
            <p>The traditional suggested distribution of group contributions is sometimes called the <strong>60-30-10 plan</strong> or, more recently, the <strong>50-30-10-10 plan</strong>. After paying group expenses (rent, literature, coffee), the remainder is split among:</p>
            <div class="row g-3 mt-2">
              <div class="col-md-6 col-lg-3">
                <div class="card-soft p-3 h-100 text-center">
                  <div class="display-6 fw-bold text-primary">50%</div>
                  <h6 class="mb-1">Area 09</h6>
                  <p class="small text-aa-muted mb-0">Funds quarterly assemblies, the Delegate's trip to the General Service Conference, and committee work.</p>
                </div>
              </div>
              <div class="col-md-6 col-lg-3">
                <div class="card-soft p-3 h-100 text-center">
                  <div class="display-6 fw-bold text-primary">30%</div>
                  <h6 class="mb-1">G.S.O.</h6>
                  <p class="small text-aa-muted mb-0">The General Service Office in New York — supports worldwide A.A. services.</p>
                </div>
              </div>
              <div class="col-md-6 col-lg-3">
                <div class="card-soft p-3 h-100 text-center">
                  <div class="display-6 fw-bold text-primary">10%</div>
                  <h6 class="mb-1">District</h6>
                  <p class="small text-aa-muted mb-0">Your local district's service work — hospitality, workshops, GSR support.</p>
                </div>
              </div>
              <div class="col-md-6 col-lg-3">
                <div class="card-soft p-3 h-100 text-center">
                  <div class="display-6 fw-bold text-primary">10%</div>
                  <h6 class="mb-1">Central Office</h6>
                  <p class="small text-aa-muted mb-0">Your local intergroup / central office — operates the 24-hour hotline and Where & When.</p>
                </div>
              </div>
            </div>
            <p class="small text-aa-muted mt-2">
              These percentages are suggestions only — each group's conscience decides. Some groups
              use the older 60-30-10 split (no central office line); others split equally; others
              earmark contributions to specific committees.
            </p>

            <h2 class="h4 mt-5">How to contribute to Area 09</h2>
            <div class="row g-3 mt-2">
              <div class="col-md-6">
                <div class="card-soft p-4 h-100">
                  <span class="icon-tile mb-3"><i class="bi bi-mailbox-flag"></i></span>
                  <h5>By mail</h5>
                  <p class="small text-aa-muted mb-2">Make check payable to <strong>MSCA09</strong> and mail to the Area Treasurer:</p>
                  <address class="small mb-0">
                    MSCA09 Treasurer<br />
                    P.O. Box [XXXX]<br />
                    San Diego, CA [ZIP]
                  </address>
                  <p class="small text-aa-muted mt-2 mb-0">Please include your group name and GSO number on the memo line so contributions can be recorded properly.</p>
                </div>
              </div>
              <div class="col-md-6">
                <div class="card-soft p-4 h-100">
                  <span class="icon-tile mb-3"><i class="bi bi-credit-card-2-front"></i></span>
                  <h5>Online (when available)</h5>
                  <p class="small text-aa-muted mb-2">
                    Some areas accept electronic contributions through services like Venmo or
                    a self-hosted contribution portal. Check with your area treasurer for the
                    current method.
                  </p>
                  <a class="btn btn-sm btn-outline-primary" href="mailto:treasurer@msca09aa.org">
                    <i class="bi bi-envelope me-1"></i>Email the treasurer
                  </a>
                </div>
              </div>
              <div class="col-md-6">
                <div class="card-soft p-4 h-100">
                  <span class="icon-tile mb-3"><i class="bi bi-globe2"></i></span>
                  <h5>To G.S.O. directly</h5>
                  <p class="small text-aa-muted mb-2">Groups or individuals may also contribute directly to the General Service Office through A.A.W.S.</p>
                  <a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="https://www.aa.org/contribution">
                    <i class="bi bi-box-arrow-up-right me-1"></i>A.A.W.S. contributions
                  </a>
                </div>
              </div>
              <div class="col-md-6">
                <div class="card-soft p-4 h-100">
                  <span class="icon-tile mb-3"><i class="bi bi-info-circle"></i></span>
                  <h5>Annual limits</h5>
                  <p class="small text-aa-muted mb-0">
                    Per G.S.O. policy, an individual A.A. member may contribute up to a published
                    annual maximum to the General Service Board. Groups have no contribution limit.
                    A.A. accepts contributions only from A.A. members — no outside contributions.
                  </p>
                </div>
              </div>
            </div>

            <div class="alert alert-info mt-5">
              <strong>A note about anonymity:</strong> If contributing by check, please use your group
              name rather than your full personal name when possible. Anonymity is the spiritual
              foundation of all our traditions.
            </div>
          </div>

          <aside class="col-lg-4">
            <div class="card-soft p-4">
              <h6 class="mb-2"><i class="bi bi-piggy-bank-fill me-1 text-primary"></i>Why we self-support</h6>
              <p class="small text-aa-muted mb-0">
                The principle of self-support keeps A.A. free of outside influence. By declining outside
                contributions, we ensure that A.A. answers only to its own group conscience — never to
                a donor, a corporation, or a government.
              </p>
            </div>
            <div class="card-soft p-4 mt-3">
              <h6 class="mb-2"><i class="bi bi-question-circle-fill me-1 text-primary"></i>Questions?</h6>
              <p class="small text-aa-muted mb-2">The Area Treasurer answers questions about group contributions and provides receipts.</p>
              <a class="btn btn-sm btn-outline-primary" href="mailto:treasurer@msca09aa.org"><i class="bi bi-envelope me-1"></i>treasurer@msca09aa.org</a>
            </div>
            <div class="card-soft p-4 mt-3">
              <h6 class="mb-2"><i class="bi bi-bookmark-star-fill me-1 text-primary"></i>Self-Support pamphlet</h6>
              <p class="small text-aa-muted mb-2">Read the A.A.W.S. pamphlet on the Seventh Tradition.</p>
              <a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" href="https://www.aa.org/pamphlets/self-support-where-money-and-spirituality-mix">
                <i class="bi bi-box-arrow-up-right me-1"></i>Self-Support — Where Money & Spirituality Mix
              </a>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `);
}
