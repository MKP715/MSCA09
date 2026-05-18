import { render, pageHeader, esc } from '../ui.js';

export async function renderAbout() {
  document.title = 'About — MSCA09';
  render(`
    ${pageHeader({
      eyebrow: 'About',
      title: 'About Mid-Southern California Area 09',
      lead: 'A.A.’s primary purpose is to carry its message to the alcoholic who still suffers. MSCA09 is one of 93 areas in the U.S./Canada that make that possible through the General Service structure.',
    })}

    <section class="section">
      <div class="container">
        <div class="row g-5">
          <div class="col-lg-8" data-aos="fade-up">
            <h2 class="h3">Who we are</h2>
            <p>
              MSCA09 is a service area of Alcoholics Anonymous within the General Service structure
              maintained by the General Service Office in New York. The area is composed of districts,
              each made up of A.A. groups. Each group selects a General Service Representative (GSR),
              districts elect a District Committee Member (DCM), and the area as a whole elects
              officers and committee chairs who serve for a two-year rotation.
            </p>
            <p>
              We are not allied with any sect, denomination, politics, organization or institution.
              Our primary purpose is to stay sober and to help other alcoholics achieve sobriety.
            </p>

            <h2 class="h3 mt-5">What we do</h2>
            <p>The Area’s work happens through quarterly Assemblies, monthly committee meetings, and ongoing service activity in the districts:</p>
            <ul>
              <li><strong>Assemblies</strong> — group consciences that direct the work of the area and elect a Delegate to the General Service Conference.</li>
              <li><strong>Committees</strong> — Public Information, Cooperation with the Professional Community, Treatment, Corrections, Accessibilities, Archives, Grapevine/La Vi&ntilde;a, Literature, and more.</li>
              <li><strong>Districts</strong> — bring service close to the groups, supporting GSRs and carrying the message locally.</li>
              <li><strong>Conference participation</strong> — the area Delegate brings the conscience of the area to the General Service Conference each spring.</li>
            </ul>

            <h2 class="h3 mt-5">The Twelve Traditions of A.A.</h2>
            <ol class="list-group list-group-numbered list-group-flush mt-3">
              ${TRADITIONS.map((t) => `<li class="list-group-item bg-transparent px-0">${esc(t)}</li>`).join('')}
            </ol>
          </div>

          <aside class="col-lg-4" data-aos="fade-left">
            <div class="card-soft p-4">
              <h5 class="mb-3">At a glance</h5>
              <dl class="row mb-0 small">
                <dt class="col-5 text-aa-muted">Region</dt><dd class="col-7">Pacific</dd>
                <dt class="col-5 text-aa-muted">Area number</dt><dd class="col-7">09</dd>
                <dt class="col-5 text-aa-muted">Rotation</dt><dd class="col-7">Two-year (even-year start)</dd>
                <dt class="col-5 text-aa-muted">Assemblies</dt><dd class="col-7">Quarterly</dd>
                <dt class="col-5 text-aa-muted">Languages</dt><dd class="col-7">English &amp; Spanish</dd>
              </dl>
            </div>

            <div class="card-soft p-4 mt-3">
              <h5 class="mb-3">A.A. Preamble</h5>
              <p class="small mb-0" style="font-family:var(--bs-font-serif); font-style:italic;">
                Alcoholics Anonymous is a fellowship of people who share their experience, strength and
                hope with each other that they may solve their common problem and help others to recover
                from alcoholism. The only requirement for membership is a desire to stop drinking.
                There are no dues or fees for A.A. membership; we are self‑supporting through our own
                contributions. A.A. is not allied with any sect, denomination, politics, organization or
                institution; does not wish to engage in any controversy; neither endorses nor opposes any
                causes. Our primary purpose is to stay sober and help other alcoholics to achieve sobriety.
              </p>
            </div>

            <div class="alert alert-info mt-3 small">
              The information on this site is provided for the convenience of A.A. members and the public.
              Anonymity is the spiritual foundation of all our traditions — please be mindful when
              sharing or republishing.
            </div>
          </aside>
        </div>
      </div>
    </section>
  `);
}

const TRADITIONS = [
  'Our common welfare should come first; personal recovery depends upon A.A. unity.',
  'For our group purpose there is but one ultimate authority — a loving God as He may express Himself in our group conscience. Our leaders are but trusted servants; they do not govern.',
  'The only requirement for A.A. membership is a desire to stop drinking.',
  'Each group should be autonomous except in matters affecting other groups or A.A. as a whole.',
  'Each group has but one primary purpose — to carry its message to the alcoholic who still suffers.',
  'An A.A. group ought never endorse, finance or lend the A.A. name to any related facility or outside enterprise, lest problems of money, property and prestige divert us from our primary purpose.',
  'Every A.A. group ought to be fully self-supporting, declining outside contributions.',
  'Alcoholics Anonymous should remain forever nonprofessional, but our service centers may employ special workers.',
  'A.A., as such, ought never be organized; but we may create service boards or committees directly responsible to those they serve.',
  'Alcoholics Anonymous has no opinion on outside issues; hence the A.A. name ought never be drawn into public controversy.',
  'Our public relations policy is based on attraction rather than promotion; we need always maintain personal anonymity at the level of press, radio and films.',
  'Anonymity is the spiritual foundation of all our traditions, ever reminding us to place principles before personalities.',
];
