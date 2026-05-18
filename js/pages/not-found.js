import { render, pageHeader } from '../ui.js';

export async function renderNotFound({ path }) {
  document.title = 'Not found — MSCA09';
  render(`
    ${pageHeader({ eyebrow: '404', title: 'Page not found', lead: `We couldn’t find ${path}.` })}
    <section class="section">
      <div class="container text-center">
        <i class="bi bi-compass display-1 text-aa-muted"></i>
        <p class="mt-3 mb-4 text-aa-muted">The page you’re looking for may have moved or never existed.</p>
        <a href="#/" class="btn btn-primary">Go to home</a>
        <a href="#/meetings" class="btn btn-outline-primary ms-2">Find a meeting</a>
      </div>
    </section>
  `);
}
