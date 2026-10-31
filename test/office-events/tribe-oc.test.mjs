// OC Intergroup (oc-aa.org): The Events Calendar's REST API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeline, tribePages, fixture } from "./helpers.mjs";
import { contactHits, summaryRisk } from "../../src/_lib/contact-rules.js";
import { wpImageFlyer } from "../../src/_lib/office-import.js";

const run = pipeline("oc-central", tribePages("oc-central"));

test("8 read, 7 kept: the monthly Intergroup Meeting is dropped", () => {
  assert.equal(run.stats.read, 8);
  assert.equal(run.records.length, 7);
  assert.equal(run.stats.meetings, 1); // its only category is "intergroup" (drop_only)
  assert.ok(!run.records.some((r) => /intergroup meeting/i.test(r.title)));
  // the Bowling Event is Intergroup + Special Events: kept
  assert.ok(run.byTitle(/bowling/i));
});

test("HTML entities in titles are decoded (&#038;)", () => {
  assert.match(fixture("oc-central", "events-1.json"), /H &#038; I Chili/);
  assert.equal(run.byTitle(/chili/i).title, "South County H & I Chili Cook-Off");
});

test("the Bowling Event's description has 'Call or text … at <phone>': its summary is left out whole", () => {
  const raw = run.raw.find((r) => /bowling/i.test(r.title));
  assert.match(raw.summary, /Call or text/);
  assert.equal(summaryRisk(raw.summary), "phone");
  const b = run.byTitle(/bowling/i);
  assert.equal(b.summary, "");
  assert.equal(b.title, "Bowling Event");
  assert.deepEqual(contactHits(b.summary), []);
  // the other events keep theirs
  assert.match(run.byTitle(/open house/i).summary, /^Come down and visit your Central Office\./);
});

test("an event whose place is only on its flyer: no place, flag place-on-flyer", () => {
  const h = run.byTitle(/^halloween party$/i);
  assert.deepEqual([h.venue, h.address, h.city, h.zip], ["", "", "", ""]);
  assert.ok(h.flags.includes("place-on-flyer"));
});

test("a PDF flyer: WordPress's -pdf.jpg preview, with a link to the .pdf", () => {
  const o = run.byTitle(/open house/i);
  assert.equal(o.flyers.length, 1);
  assert.match(o.flyers[0].url, /-pdf\.jpg$/);
  assert.equal(o.flyers[0].mime, "image/jpeg");
  assert.equal(o.flyers[0].pdf, o.flyers[0].url.replace(/-pdf\.jpg$/, ".pdf"));
});

test("ACYPAA is all day from 2027-04-15 to 2027-04-18 (inclusive)", () => {
  const a = run.byTitle(/ACYPAA/);
  assert.equal(a.allDay, true);
  assert.equal(a.start, "2027-04-15");
  assert.equal(a.endDate, "2027-04-18");
  assert.equal(a.end, "");
  assert.equal(a.type, "YPAA");
});

test("times come from utc_start_date / utc_end_date, shown in Pacific time (daylight saving ends Nov 1)", () => {
  const c = run.byTitle(/chili/i);
  assert.equal(c.start, "2026-10-31T11:00:00-07:00");
  assert.equal(c.end, "2026-10-31T14:00:00-07:00");
  const b = run.byTitle(/bowling/i);
  assert.equal(b.start, "2026-11-01T12:30:00-08:00");
  assert.equal(b.end, "2026-11-01T14:00:00-08:00");
  // a dance until 2 am is not a two-day event
  const d = run.byTitle(/dance of the dead/i);
  assert.equal(d.end, "2026-11-01T02:00:00-08:00");
  assert.equal(d.endDate, "");
  assert.equal(d.cost, "$20");
});

test("types, and no tracking or virtual-meeting links stored", () => {
  assert.equal(run.byTitle(/bowling/i).type, "Social");
  assert.equal(run.byTitle(/traditions day/i).type, "Workshop");
  assert.equal(run.byTitle(/open house/i).type, "Social");
  const text = JSON.stringify(run.records);
  assert.doesNotMatch(text, /urldefense|utm_|zoom\.us|chatgpt/i);
  for (const r of run.records) assert.match(r.src, /^https:\/\/www\.oc-aa\.org\/event\//);
});

test("an http:// flyer of the `image` object (and its sizes) becomes https:// (the site shows https flyers only)", () => {
  const f = wpImageFlyer({
    url: "http://www.oc-aa.org/wp-content/uploads/2026/10/flyer.jpg",
    width: 1275,
    height: 1650,
    sizes: { medium: { url: "http://www.oc-aa.org/wp-content/uploads/2026/10/flyer-232x300.jpg", width: 232 }, large: { url: "https://www.oc-aa.org/wp-content/uploads/2026/10/flyer-791x1024.jpg", width: 791 } },
  });
  assert.equal(f.url, "https://www.oc-aa.org/wp-content/uploads/2026/10/flyer.jpg");
  assert.deepEqual(f.sizes, [
    [232, "https://www.oc-aa.org/wp-content/uploads/2026/10/flyer-232x300.jpg"],
    [791, "https://www.oc-aa.org/wp-content/uploads/2026/10/flyer-791x1024.jpg"],
  ]);
  const pdf = wpImageFlyer({ url: "http://www.oc-aa.org/wp-content/uploads/2026/10/open-house-pdf.jpg", extension: "jpg" });
  assert.equal(pdf.pdf, "https://www.oc-aa.org/wp-content/uploads/2026/10/open-house.pdf");
  for (const r of run.records) for (const x of r.flyers) assert.match(x.url, /^https:\/\//);
});
