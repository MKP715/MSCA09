// Oficina Intergrupal del Sur de la Bahía (aasurdelabahia.org): flyers inside the description, "Rol de visita"
// entries (visits to a group's regular meeting), conventions posted as one entry per day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeline, tribePages, clone } from "./helpers.mjs";

const pages = tribePages("sur-bahia");
const base = pages[0].events[0];

test("the anniversary: 4 flyer pages from the description, Spanish, no text summary", () => {
  const run = pipeline("sur-bahia", pages);
  assert.equal(run.records.length, 1);
  const a = run.records[0];
  assert.equal(a.title, "Aniversario #39 grupo Buscando Sobriedad");
  assert.equal(a.lang, "Spanish");
  assert.equal(a.type, "Social");
  assert.equal(a.start, "2026-11-01T13:00:00-08:00");
  assert.equal(a.flyers.length, 4);
  for (const f of a.flyers) {
    assert.match(f.url, /^https:\/\/aasurdelabahia\.org\/wp-content\/uploads\/2026\/10\/Buscando-[Ss]obriedad-\d\.jpg$/);
    assert.ok(f.w > 0 && f.h > 0);
  }
  assert.ok(!a.flags.includes("place-on-flyer"));
});

test("Rol de visita is dropped by its category, and by its title alone", () => {
  const byCat = { ...clone(base), id: 3300, url: "https://aasurdelabahia.org/event/rol-x/", title: "Visita al grupo Nueva Vida", categories: [{ slug: "rol-de-visita", name: "Rol de Visita" }] };
  const byTitle = { ...clone(base), id: 3301, url: "https://aasurdelabahia.org/event/rol-y/", title: "ROI DE VISITAS Grupo Nueva Vida (PLANIFICADAS)", categories: [] };
  const run = pipeline("sur-bahia", [{ events: [clone(base), byCat, byTitle] }]);
  assert.equal(run.stats.meetings, 1); // the category
  assert.equal(run.dropped.meetings, 1); // the title
  assert.deepEqual(run.records.map((r) => r.id), ["co-sur-bahia-3246"]);
});

test("a convention posted as 3 entries on following days becomes one event, first start to last end", () => {
  const day = (n, id) => ({
    ...clone(base), id, url: `https://aasurdelabahia.org/event/convencion-${id}/`, title: "XXVI Convención Hispana del Condado de Orange", categories: [{ slug: "convencion" }],
    start_date: `2026-11-${n} 08:00:00`, end_date: `2026-11-${n} 20:00:00`, utc_start_date: `2026-11-${n} 16:00:00`, utc_end_date: `2026-11-${Number(n) + 1} 04:00:00`,
    description: `<p><img src="https://aasurdelabahia.org/wp-content/uploads/2026/10/conv-${n}.jpg" width="600" height="800"></p>`,
  });
  const run = pipeline("sur-bahia", [{ events: [day("06", 3401), day("07", 3402), day("08", 3403)] }]);
  assert.equal(run.records.length, 1);
  const c = run.records[0];
  assert.equal(c.id, "co-sur-bahia-3401");
  assert.equal(c.start, "2026-11-06T08:00:00-08:00");
  assert.equal(c.end, "2026-11-08T20:00:00-08:00");
  assert.equal(c.endDate, "2026-11-08");
  assert.equal(c.type, "Convention");
  assert.equal(c.flyers.length, 3);
});

test("pictures from other hosts (a mail proxy) are skipped; resized copies give the original and its sizes", () => {
  const ev = {
    ...clone(base),
    description:
      '<p><img src="https://ecp.yusercontent.com/mail?url=https%3A%2F%2Fx.example%2Fa.jpg&t=1&sig=abc" width="300" height="400"></p>' +
      '<p><img class="wp-image-9" src="https://aasurdelabahia.org/wp-content/uploads/2026/10/flyer-768x1024.jpg" width="768" height="1024" ' +
      'srcset="https://aasurdelabahia.org/wp-content/uploads/2026/10/flyer-225x300.jpg 225w, https://aasurdelabahia.org/wp-content/uploads/2026/10/flyer-768x1024.jpg 768w, https://aasurdelabahia.org/wp-content/uploads/2026/10/flyer.jpg 1200w"></p>',
  };
  const run = pipeline("sur-bahia", [{ events: [ev] }]);
  const [f, ...rest] = run.records[0].flyers;
  assert.equal(rest.length, 0);
  assert.equal(f.url, "https://aasurdelabahia.org/wp-content/uploads/2026/10/flyer.jpg");
  assert.deepEqual([f.w, f.h], [1200, 1600]);
  assert.deepEqual(f.sizes.map(([w]) => w), [225, 768]);
});
