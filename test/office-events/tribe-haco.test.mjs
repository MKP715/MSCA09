// Harbor Area Central Office (hacoaa.org): many repeating service meetings, two single events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeline, tribePages } from "./helpers.mjs";

const run = pipeline("haco", tribePages("haco"));

test("90 read over 2 pages, 2 kept (the rest are dates of repeating series)", () => {
  assert.equal(tribePages("haco").length, 2);
  assert.equal(run.stats.read, 90);
  assert.equal(run.stats.recurring, 88);
  assert.equal(run.records.length, 2);
});

test("the Traditions Banquet: cost $60 from cost_details, no summary (description=off), a PDF flyer preview", () => {
  const b = run.byTitle(/banquet/i);
  assert.equal(b.title, "Traditions Banquet"); // title_case=yes
  assert.equal(b.cost, "$60");
  assert.equal(b.summary, "");
  assert.equal(b.type, "Social");
  assert.ok(b.flags.includes("place-on-flyer"));
  assert.match(b.flyers[0].url, /Trad-Bqt-flyer-2026-pdf\.jpg$/);
  assert.match(b.flyers[0].pdf, /Trad-Bqt-flyer-2026\.pdf$/);
  assert.equal(b.start, "2026-11-21T18:30:00-08:00");
});

test("the Hispanic Women's Workshop: all day, entity decoded, title case, venue", () => {
  const w = run.byTitle(/women/i);
  assert.equal(w.title, "11th Annual Hispanic Women’s Workshop");
  assert.equal(w.allDay, true);
  assert.equal(w.start, "2026-12-12");
  assert.equal(w.endDate, "2026-12-12");
  assert.equal(w.venue, "My Safe Harbor");
  assert.equal(w.city, "Anaheim");
  assert.equal(w.type, "Workshop");
  assert.equal(w.summary, "");
});
